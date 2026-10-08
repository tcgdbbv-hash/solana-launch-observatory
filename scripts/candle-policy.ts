import { existsSync } from 'node:fs';
if(existsSync('.env'))process.loadEnvFile('.env');
const choice=process.argv[2];
if(!['priority','legacy','discovery','balanced'].includes(choice))throw new Error('Choose priority, legacy, discovery or balanced');
const field=choice==='discovery'||choice==='balanced'?'profile':'mode';
const port=Number(process.env.PORT||4310);
const response=await fetch(`http://127.0.0.1:${port}/api/candle-scheduler`,{
  method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({[field]:choice}),signal:AbortSignal.timeout(15_000),
});
if(!response.ok)throw new Error(`Could not change scheduling (${response.status}); the app must be running.`);
const result=await response.json() as {mode:string;profile:string};
if(result[field]!==choice)throw new Error('Scheduling change was not confirmed');
console.log(`${field==='profile'?'Candle balance':'Scheduling'} set to ${choice}. All saved data and feedback are retained.${field==='profile'&&result.mode==='legacy'?' Use candles:prioritise to activate the priority scheduler.':''}`);
