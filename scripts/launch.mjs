import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { open, readFile, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { setTimeout as delay } from 'node:timers/promises';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const noBrowser = process.argv.includes('--no-browser');
let child, stopping = false, ownsLock = false, lockPath;
const logDirectory = resolve(root, 'logs');
mkdirSync(logDirectory, { recursive: true });
const logPath = resolve(logDirectory, 'launcher.log');
let logFailed = false;
function record(chunk) {
  try { appendFileSync(logPath, chunk, { mode: 0o600 }); }
  catch {
    if (!logFailed) console.error('Startup log is unavailable. Messages remain visible in this window.');
    logFailed = true;
  }
}
function log(message) { console.log(message); record(`${message}\n`); }
record(`\n[${new Date().toISOString()}] Launcher ${process.pid}\n`);

// Keep the actual server as a direct child so closing Terminal or pressing
// Control-C also stops the collector and lets it close its database normally.
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    stopping = true;
    child?.kill('SIGTERM');
  });
}

function run(command, args) {
  if (stopping) throw new Error('Launch cancelled.');
  const proc = spawn(command, args, { cwd: root, env: process.env, stdio: ['inherit', 'pipe', 'pipe'] });
  proc.stdout.on('data', chunk => { process.stdout.write(chunk); record(chunk); });
  proc.stderr.on('data', chunk => { process.stderr.write(chunk); record(chunk); });
  child = proc;
  let finished = false;
  const done = new Promise((accept) => {
    proc.once('error', error => { finished = true; accept({ code: 1, error }); });
    proc.once('exit', (code, signal) => { finished = true; accept({ code: code ?? (signal ? 1 : 0) }); });
  });
  return { proc, done, finished: () => finished };
}

async function prepare(args) {
  const task = run('npm', args);
  const result = await task.done;
  child = undefined;
  if (result.error || result.code !== 0) throw new Error(`App preparation failed. See the message above, fix it, and launch again.`);
}

async function isReady(url) {
  let response, body, legacy = false;
  try {
    response = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(5000), redirect: 'error' });
    // An older running Observatory can still be opened without a second collector.
    if (response.status === 404) {
      legacy = true;
      response = await fetch(`${url}/api/overview`, { signal: AbortSignal.timeout(10_000), redirect: 'error' });
    }
    body = await response.text();
  } catch { return false; }
  let value;
  try { value = JSON.parse(body); } catch { /* A different app may be using this port. */ }
  if (response.ok && !legacy && value?.app === 'solana-launch-observatory' && value.status === 'ready') return true;
  if (response.ok && legacy && value?.mode === 'live' && Array.isArray(value.pools)
      && Array.isArray(value.candidates) && Array.isArray(value.coverage) && value.counts) return true;
  throw new Error(`Another service is responding at ${url}. Close that service or set a different PORT in .env.`);
}

async function openBrowser(url) {
  if (noBrowser || stopping) return;
  const result = await new Promise(accept => {
    const opener = spawn('/usr/bin/open', [url], { stdio: 'ignore' });
    opener.once('error', () => accept(1));
    opener.once('exit', code => accept(code));
  });
  if (result !== 0) log(`Open this address in your browser: ${url}`);
}

async function takeLock() {
  try {
    const file = await open(lockPath, 'wx', 0o600);
    ownsLock = true;
    try { await file.writeFile(String(process.pid)); } finally { await file.close(); }
    return true;
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  // Recover only a lock whose recorded launcher process has actually exited.
  let owner;
  try { owner = Number(await readFile(lockPath, 'utf8')); } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
  if (Number.isSafeInteger(owner) && owner > 0) {
    try { process.kill(owner, 0); } catch (error) {
      if (error.code === 'ESRCH') await unlink(lockPath).catch(() => {});
    }
  }
  return false;
}

async function launch() {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const port = Number(process.env.PORT || 4310);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a number between 1 and 65535.');
  const url = `http://127.0.0.1:${port}`;
  lockPath = resolve(root, `.launcher-${port}.lock`);
  log('\nObservatory — live Solana scanner\n');
  if (await isReady(url)) {
    log(`The app is already running at ${url}. Opening it now.`);
    await openBrowser(url);
    return;
  }
  // A second double-click waits for the first launch instead of starting another
  // collector against the same database while dependencies/builds are preparing.
  let waitingNotice = false;
  const deadline = Date.now() + 180_000;
  while (!(await takeLock())) {
    if (stopping) return;
    if (!waitingNotice) { log('Another launch is preparing the app. Waiting for it to open…'); waitingNotice = true; }
    if (await isReady(url)) { await openBrowser(url); return; }
    if (Date.now() >= deadline) throw new Error('The other launch is still preparing the app. Check its Terminal window.');
    await delay(1000);
  }
  // Recheck after acquiring the lock in case another launch just became ready.
  if (await isReady(url)) { await openBrowser(url); return; }
  if (!existsSync('node_modules/.bin/tsx') || !existsSync('node_modules/.bin/vite') || !existsSync('node_modules/.bin/tsc')) {
    log('Installing the project dependencies. This first step needs an internet connection…');
    await prepare(['ci', '--include=dev', '--no-audit', '--no-fund']);
  }
  log('Preparing the latest app…');
  await prepare(['run', 'build']);
  log(`\nStarting ${url}\nKeep this Terminal window open while scanning. Press Control-C to stop.\nStartup log: ${logPath}\n`);
  const server = run(process.execPath, ['--import', 'tsx', 'server/index.ts']);
  const readyDeadline = Date.now() + 30_000;
  while (!server.finished() && !stopping) {
    if (await isReady(url)) {
      log('Scanner ready. Opening your browser.');
      await openBrowser(url);
      const result = await server.done;
      child = undefined;
      if (!stopping && result.code !== 0) throw new Error('The scanner stopped unexpectedly. See the message above.');
      log('\nScanner stopped. Saved charts, notes and feedback remain in your database.');
      return;
    }
    if (Date.now() >= readyDeadline) throw new Error('The scanner did not become ready within 30 seconds. See the messages above.');
    await delay(350);
  }
  const result = await server.done;
  child = undefined;
  if (!stopping) throw new Error(result.error?.message || 'The scanner could not start. See the message above.');
}

try {
  await launch();
} catch (error) {
  if (!stopping) {
    console.error(`\n${error.message}`);
    record(`\n${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
} finally {
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGTERM');
    await new Promise(accept => {
      const timer = setTimeout(() => { child?.kill('SIGKILL'); accept(); }, 7000);
      child.once('exit', () => { clearTimeout(timer); accept(); });
    });
  }
  if (ownsLock) await unlink(lockPath).catch(() => {});
}
if (process.exitCode && process.stdin.isTTY && !stopping) {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try { await prompt.question('\nPress Return to close this window.'); } finally { prompt.close(); }
}
