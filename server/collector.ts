import WebSocket from 'ws';
import type { Pool, SourceHealth, QuoteEvidence, LaunchOrigin, TradingProgress } from '../shared/types.ts';
import { Store, NOTIFICATION_POLICY } from './store.ts';
import { addressValid, dexPool, geckoCandles, geckoPool, meteoraPool, SOL } from './providers.ts';
import { closedCandles, detectEpisodes } from './detector.ts';
import { ACTIVE_VENUES, inScope, isDlmm } from '../shared/scope.ts';
import { comparePools } from './pool-context.ts';
import { BASE_VERSION, BASE_MAX_AGE, BASE_POLICY, currentBase } from '../shared/base.ts';
import { parseSupplyOrigin, SUPPLY_POLICY, SUPPLY_PARSER_VERSION, MAX_TRANSACTION_VERSION } from './supply.ts';
import { launchAddresses, parsePumpOrigin, parseLaunchLabOrigin, launchSupply, LAUNCH_ORIGIN_VERSION } from './launch-origin.ts';
import { knownLowLiquidity, pendingProtection, decodeLiquidityPool, assessProtection, RAY_CPMM, RAY_LOCK_AUTH, LIQUIDITY_POLICY } from './liquidity.ts';
import { assessMint, assessProgram, assessLiquidity, assessTrading, fresh, parseQuote, pendingSecurity, pendingTrading,
  RISK_POLICY, TOKEN, TOKEN_2022, USDC, type ProgramEvidence } from './security.ts';
import { CandleScheduler, type CandleRequestContext } from './candle-scheduler.ts';
import { Deferred } from './provider-error.ts';
import { DRAWDOWN_POLICY, extremeDrawdown } from '../shared/drawdown.ts';
export { Deferred } from './provider-error.ts';

const GECKO = 'https://api.geckoterminal.com/api/v2';
const names: Record<string, string> = { gecko: 'GeckoTerminal · candles & discovery', dex: 'DEX Screener · activity',
  damm: 'Meteora · DAMM v2', dlmm: 'Meteora · DLMM', rpc: 'Solana · controls & launch evidence', pump: 'PumpPortal · migrations', quotes: 'Jupiter · read-only buy/sell quotes', stonk: 'StonkFun · launch origin hints' };
const limits: Record<string, number> = { gecko: 24, dex: 50, damm: 30, dlmm: 30, rpc: 35, quotes: 20, stonk: 6 };
interface SupplySearch { before?: string; pages: number; probes: string[]; exhausted: boolean; nextAt: number; issue: string; signature?: string; parserVersion?: number; lastAttempt?: number; }

export class Collector {
  startedAt = Date.now();
  private timer?: ReturnType<typeof setInterval>;
  private socket?: WebSocket;
  private socketRetry = 0;
  private socketFailures = 0;
  private jobs = new Set<string>();
  private stopped = false;
  private next = new Map<string, number>();
  private providerNext = new Map<string, number>();
  private providerTurns = new Map<string, Promise<void>>();
  private tradingPool: string | null = null;
  readonly candleScheduler:CandleScheduler;
  constructor(public store: Store, private rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com') {
    this.candleScheduler=new CandleScheduler(store,(p,now)=>this.basePriority(p,now));
  }
  // Queue priority only; this never relaxes formation or eligibility rules.
  private basePriority(pool: Pool, now: number): number {
    const c=this.store.candidate(pool.mint), base=this.store.base(pool.address);
    if(!c||c.pool!==pool.address||c.archived||c.researchTags?.includes('not_matching')
      ||!inScope(pool)||knownLowLiquidity(pool,now)||this.store.security(pool.mint).status==='excluded'||extremeDrawdown(this.store.drawdown(pool,now)))return 0;
    if(currentBase(base,now))return 2;
    // Watch plausible ranges more closely before their final retests arrive.
    // A pump alone, a stale assessment or a dead chart earns no priority.
    return base?.version===BASE_VERSION&&base.status==='forming'&&base.candleEnd!==null
      &&base.candleEnd<=now&&now-base.candleEnd<=BASE_MAX_AGE&&base.shape!=='unsettled'
      &&base.durationHours>=1&&base.coveragePercent>=BASE_POLICY.minCoveragePercent
      &&(base.activePercent??0)>=BASE_POLICY.minActivePercent
      &&(base.pullbackPercent??0)>=BASE_POLICY.minPullbackPercent
      &&base.widthPercent!==null&&base.widthPercent>=.25&&base.widthPercent<=BASE_POLICY.maxWidthPercent
      &&base.floorTests>=2&&base.ceilingTests>=1?1:0;
  }
  private priorityTurn(job: string) { return this.store.get(`priorityTurn:${job}`,0)%3!==2; }
  private candlePriority(pool:Pool,now:number) {
    const c=this.store.candidate(pool.mint),base=this.store.base(pool.address);
    if(!c||c.pool!==pool.address||c.archived||c.researchTags?.includes('not_matching')||!inScope(pool)
      ||knownLowLiquidity(pool,now)||this.store.security(pool.mint).status==='excluded')return 0;
    // An expired assessment needs another look; expiry must not drop a recent
    // match behind every early pump. This schedules work, never admits a coin.
    if(!extremeDrawdown(this.store.drawdown(pool,now))&&base?.version===BASE_VERSION&&base.status==='qualified'&&base.candleEnd!==null
      &&base.candleEnd<=now&&now-base.candleEnd<=86_400_000)return 2;
    return Math.max(this.basePriority(pool,now),c.manualWatch||c.pinned?1:0);
  }
  private served(job: string) { this.store.set(`priorityTurn:${job}`,this.store.get(`priorityTurn:${job}`,0)+1); }
  private checkRequested(pool:Pool,job:string) {
    const requested=this.store.get<number>(`checkRefresh:${pool.address}`,0);
    if(!requested)return false;
    const checked=job==='controls'?this.store.security(pool.mint).checkedAt
      :job==='protection'?this.store.protection(pool).checkedAt
      :job==='trading'?this.store.trading(pool).status==='pending'?null:this.store.trading(pool).checkedAt
      :job==='supply'?this.store.supply(pool.mint).status==='passed'?requested:this.store.get<SupplySearch|null>(`supplySearch:${pool.mint}`,null)?.lastAttempt
      :job==='metrics'?pool.metricsAt:requested;
    return requested>(checked??0);
  }
  private verificationPriority(pool:Pool,job:string,now:number) {
    const c=this.store.candidate(pool.mint);
    if(c?.archived||c?.researchTags?.includes('not_matching')||!inScope(pool)||knownLowLiquidity(pool,now))return 0;
    if(this.checkRequested(pool,job))return 4;
    if(c?.pool===pool.address&&(c.manualWatch||c.pinned||this.store.get<{firstAt:number|null}|null>(`baseAdmission:${pool.address}`,null)?.firstAt))return 3;
    return this.basePriority(pool,now);
  }
  queueChecks(address:string) {
    const pool=this.store.pool(address),now=Date.now();
    if(!pool||!inScope(pool)||knownLowLiquidity(pool,now)||this.store.candidate(pool.mint)?.archived)
      throw new Error('Choose an active PumpSwap or Raydium pool with at least $1,000 reported liquidity');
    const previous=this.store.get<number>(`checkRefresh:${address}`,0);
    if(now-previous<60_000)return previous;
    this.store.transaction(()=>{
      this.store.set(`checkRefresh:${address}`,now);
      this.store.audit('review',pool.mint,'Verification refresh requested; saved proof and supply-history cursor retained',{pool:address,requestedAt:now},now);
    });
    return now;
  }
  private prioritize<T>(items:T[],job:string,now:number,pool:(item:T)=>Pool|undefined,oldest:(a:T,b:T)=>number) {
    const priorities=new Map(items.map(item=>{const p=pool(item);return [item,p?this.verificationPriority(p,job,now):0] as const;}));
    const priorityTurn=this.priorityTurn(job);
    return items.sort((a,b)=>(priorityTurn?priorities.get(b)!-priorities.get(a)!:0)||oldest(a,b));
  }
  get running() { return !this.stopped && this.store.get('scanEnabled', process.env.LIVE_SCAN !== '0'); }
  start() {
    this.store.migrateResearchArchivePolicy();
    if(this.store.get<string>('pumpWindowPolicy','')!=='relative-volume-hours-v1')this.store.transaction(()=>{
      const previous=this.store.settings();
      const settings={...previous,windows:[...new Set([...previous.windows,48,72])].sort((a,b)=>a-b)};
      this.store.set('detector',settings);this.store.set('pumpWindowPolicy','relative-volume-hours-v1');
      this.store.audit('settings','detector','Include multi-hour rises and compare volume to the same coin’s earlier activity',{previous,current:settings,baselineMinimumBars:3,universalDollarVolumeThreshold:false});
    });
    this.store.migrateBasePolicy();
    if(this.store.get<string>('baseAdmissionPolicy','')!=='immediate-current-range-v1')this.store.transaction(()=>{
      this.store.set('baseAdmissionPolicy','immediate-current-range-v1');
      this.store.audit('settings','consolidation','Prioritize fresh bases and admit on evidence arrival while current price remains in range',{
        immediateOn:['base assessment','token controls','initial supply','LP protection','tradeability','fresh price','manual review'],
        safeguards:'Existing eligibility checks remain required; completed candles only; no later breakout required',
        scheduling:'Base priority within existing provider budgets, with oldest-due turns retained',
        observationLatency:'5m candle close plus settlement, provider availability, queue and UI refresh',
      });
    });
    if(this.store.get<string>('drawdownPolicy','')!==DRAWDOWN_POLICY.version)this.store.transaction(()=>{
      this.store.set('drawdownPolicy',DRAWDOWN_POLICY.version);
      this.store.audit('settings','drawdown','Hold extreme retracements out of automatic shortlist tiers; manual placement remains separate',
        {...DRAWDOWN_POLICY,measurement:'Current price versus recorded same-pool peak closing price',automaticTraining:false});
    });
    this.store.audit('system', 'scanner', 'Live scanner started', { policyVersion: RISK_POLICY.version, detector: this.store.settings() });
    const previousPolicy = this.store.get<unknown>('activeRiskPolicy', null);
    if (JSON.stringify(previousPolicy) !== JSON.stringify(RISK_POLICY)) this.store.transaction(() => {
      this.store.set('activeRiskPolicy', RISK_POLICY);
      this.store.audit('settings', 'risk-policy', 'Risk screening policy loaded; prior evidence retained', { previous: previousPolicy, current: RISK_POLICY,
        approvedExceptions: ['Standard Token-2022 shared upgradeability is a notice', 'Transfer-fee configurations are allowed and disclosed'] });
    });
    const previousScope = this.store.get<unknown>('activeVenues', null);
    if(this.store.get<string>('notificationPolicy','')!==NOTIFICATION_POLICY)this.store.transaction(()=>{
      this.store.set('notificationPolicy',NOTIFICATION_POLICY);
      this.store.audit('settings','notifications','Only qualifying consolidations and changes to tracked charts appear in Updates',{discovery:'Quiet background history',tracked:'Manual follows or previously shortlisted charts',policyVersion:NOTIFICATION_POLICY});
    });
    if(this.store.get<string>('supplyPolicy','')!==SUPPLY_POLICY)this.store.transaction(()=>{
      this.store.set('supplyPolicy',SUPPLY_POLICY);this.store.audit('settings','supply-policy','Require initial issuance of 1 billion tokens and current supply at most 1 billion',{policy:SUPPLY_POLICY,burnedSupplyAllowed:true,unknown:'Withheld pending verification'});
    });
    if(this.store.get<string>('liquidityPolicy','')!==LIQUIDITY_POLICY.version)this.store.transaction(()=>{
      this.store.set('liquidityPolicy',LIQUIDITY_POLICY.version);this.store.audit('settings','liquidity-policy','Disregard pools below $1,000; require verified LP burn or lock protection',{...LIQUIDITY_POLICY,unknown:'Pending; not an automatic scam label',requiredProtection:'All recorded LP rights'});
    });
    if (JSON.stringify(previousScope)!==JSON.stringify(ACTIVE_VENUES)) this.store.transaction(()=>{
      this.store.set('activeVenues',ACTIVE_VENUES);this.store.audit('settings','venue-scope','Live scope set to PumpSwap and Raydium; Meteora history retained',{previous:previousScope,current:ACTIVE_VENUES});
    });
    for(const pool of this.store.pools().filter(isDlmm))if(!this.store.poolContext(pool.mint))this.queuePoolContext(pool.mint);
    for (const [id, name] of Object.entries(names)) this.store.setHealth(id, name, id==='damm'
      ? { state: 'disabled', detail: 'Meteora collection paused by you; historical evidence retained' }
      : { state: 'idle', detail: 'Waiting for a live request' });
    this.store.setHealth('coverage', 'Additional graduation routes', { state: 'limited', detail: 'Full Raydium graduation origins remain partially covered. Meteora monitoring is paused by user choice.' });
    this.timer = setInterval(() => this.tick(), 1000); this.tick();
  }
  stop() { this.store.audit('system', 'scanner', 'Scanner stopping'); this.stopped = true; clearInterval(this.timer); this.socket?.terminate(); }
  enable(value: boolean) { this.store.audit('review', 'scanner', value ? 'Scanner resumed' : 'Scanner paused'); this.store.set('scanEnabled', value); if (!value) this.socket?.close(); else { this.socketRetry = 0; this.tick(); } }
  health(id: string, patch: Partial<SourceHealth>) { this.store.setHealth(id, names[id] ?? id, patch); }
  async request(id: string, url: string, init?: RequestInit, context?:CandleRequestContext, onDispatch?:()=>void): Promise<any> {
    // Different check jobs often become due on the same tick. Serialize their
    // short provider spacing instead of repeatedly discarding the later jobs.
    const previous=this.providerTurns.get(id)??Promise.resolve();
    let release!:()=>void;
    const turn=new Promise<void>(resolve=>{release=resolve;});
    this.providerTurns.set(id,turn);
    await previous;
    try{return await this.providerRequest(id,url,init,context,onDispatch);}
    finally{release();if(this.providerTurns.get(id)===turn)this.providerTurns.delete(id);}
  }
  private async providerRequest(id:string,url:string,init?:RequestInit,context?:CandleRequestContext,onDispatch?:()=>void):Promise<any> {
    const priority=id==='gecko'&&this.candleScheduler.mode==='priority';
    const pace=priority?Math.max(2,Math.min(8,this.store.get('candleGeckoPace',8))):limits[id];
    const spacing=id==='gecko'?priority?Math.ceil(60_000/pace):2500:id==='quotes'?(process.env.JUPITER_API_KEY?1100:2200):id==='stonk'?10_000:150;
    const delay=Math.max(this.providerNext.get(id)??0,this.store.get<number>(`providerCooldown:${id}`,0),priority?this.store.get('candleGeckoNext',0):0)-Date.now();
    // Long server cooldowns stay deferred, preserving Retry-After and budgets.
    if(delay>spacing)throw new Deferred('Provider cooldown; request stays queued');
    if(delay>0)await new Promise(resolve=>setTimeout(resolve,delay));
    if(this.stopped||context&&(!this.running||this.candleScheduler.mode!=='priority'))throw new Deferred('Scanner or scheduler changed; request remains queued');
    const now=Date.now();
    // Count persisted minute buckets conservatively, including unsuccessful requests.
    if (this.store.countRequests(id, now - 60_000) >= pace) {
      this.health(id, { state: 'limited', detail: 'Local request budget reached; work remains queued' });
      throw new Deferred('Free request budget reached; request stays queued');
    }
    this.providerNext.set(id, now + spacing);
    if(priority)this.store.set('candleGeckoNext',now+spacing);
    this.store.request(id, now);
    onDispatch?.();
    const h = this.store.health().find(h => h.id === id);
    this.health(id, { lastAttempt: now, requests: (h?.requests ?? 0) + 1 });
    const operation = id === 'rpc' ? JSON.parse(String(init?.body ?? '{}')).method : new URL(url).pathname;
    const requestId = this.store.audit('request', id, 'Source request started', { operation, ...(context?{candleJob:context}:{}) }, now);
    try {
      const res = await fetch(url, { ...init, headers: { Accept: 'application/json', ...init?.headers }, signal: AbortSignal.timeout(15_000) });
      if(id==='stonk'&&res.status===404) {
        this.health(id,{state:'ok',lastSuccess:Date.now(),detail:'Origin lookup answered; token is not in the StonkFun index'});
        this.store.audit('request',id,'Source lookup returned no match',{requestId,operation,httpStatus:404,elapsedMs:Date.now()-now});
        return {data:{token:null}};
      }
      if (!res.ok) {
        this.store.audit('request', id, 'Source request failed', { requestId, operation, httpStatus: res.status, elapsedMs: Date.now()-now });
        if (res.status === 429) {
          if(priority){this.store.set('candleGeckoPace',Math.max(2,Math.floor(pace*.75)));this.store.set('candleGeckoSuccesses',0);}
          const retry=res.headers.get('retry-after'), seconds=Number(retry),reset=Number(res.headers.get('x-ratelimit-reset'));
          const retryAt=Number.isFinite(seconds)&&seconds>0?Date.now()+seconds*1000:retry?Date.parse(retry):NaN;
          const resetAt=reset>1e12?reset:reset>0?reset*1000:0;
          const nextAt=Math.max(Date.now()+60_000,Number.isFinite(retryAt)?retryAt:0,resetAt);
          this.providerNext.set(id,nextAt);this.store.set(`providerCooldown:${id}`,nextAt);
          this.health(id,{nextAt});
        }
        throw new Error(`Provider returned HTTP ${res.status}`);
      }
      const data = await res.json();
      if (data?.error) throw new Error(`Provider response error: ${String(data.error.message ?? 'request rejected').slice(0,120)}`);
      if(priority) {
        const successes=this.store.get('candleGeckoSuccesses',0)+1;
        this.store.set('candleGeckoSuccesses',successes>=20?0:successes);
        if(successes>=20)this.store.set('candleGeckoPace',Math.min(8,pace+1));
      }
      if(res.headers.get('x-ratelimit-remaining')==='0') {
        const reset=Number(res.headers.get('x-ratelimit-reset')),resetAt=reset>1e12?reset:reset*1000;
        const nextAt=Math.max(this.providerNext.get(id)??0,Number.isFinite(resetAt)&&resetAt>Date.now()?resetAt:Date.now()+60_000);
        this.providerNext.set(id,nextAt);this.store.set(`providerCooldown:${id}`,nextAt);
      }
      this.health(id, { state: 'ok', lastSuccess: Date.now(), detail: 'Live response received; indexing delay and route coverage may vary' });
      this.store.audit('request', id, 'Source response received', { requestId, operation, httpStatus: res.status, elapsedMs: Date.now()-now,
        contextSlot: id==='rpc' ? data.result?.context?.slot ?? null : null });
      return data;
    } catch (error) {
      this.health(id, { state: 'error', detail: safeError(error), errors: (h?.errors ?? 0) + 1 });
      this.store.audit('error', id, safeError(error), { requestId, operation, elapsedMs: Date.now()-now });
      throw error;
    }
  }
  private run(id: string, interval: number, fn: () => Promise<void>) {
    if (this.jobs.has(id) || Date.now() < (this.next.get(id) ?? 0)) return;
    this.jobs.add(id); this.next.set(id, Date.now() + interval);
    void fn().catch(error => {
      if (!(error instanceof Deferred)) { this.store.audit('error', id, safeError(error)); console.warn(`[${id}] ${safeError(error)}`); }
    }).finally(() => this.jobs.delete(id));
  }
  private tick() {
    if (!this.running) return;
    if (!this.socket && Date.now() >= this.socketRetry) this.connectPump();
    this.run('indexed-discovery', 90_000, () => this.geckoDiscovery());
    this.run('dlmm-context-discovery',60_000,()=>this.meteora('dlmm','dlmm','DLMM'));
    this.run('pool-context',8000,()=>this.resolvePoolContext());
    this.run('metrics', 2000, () => this.metrics());
    this.run('token-controls', 4000, () => this.tokenControls());
    this.run('launch-origin', 6000, () => this.launchOrigins());
    this.run('stonk-origin-hints', 30_000, () => this.stonkOriginHints());
    this.run('supply-origin', 60_000, () => this.supplyOrigins());
    this.run('liquidity-protection', 12000, () => this.liquidityProtection());
    this.run('tradeability', 4000, () => this.tradeability());
    this.run('eligibility-log', 15_000, async () => this.store.observeGroups());
    this.run('candles', 4000, () => this.candles());
    if(this.candleScheduler.mode==='legacy')this.run('candle-history', 45_000, () => this.candleHistory());
    this.run('raydium', 60_000, () => this.raydium());
    this.run('resolve-migrations', 7000, () => this.resolveMigrations());
  }
  private async meteora(id: string, host: string, route: string) {
    let overlap = false, added = 0;
    for (let page = 1; page <= 3; page++) {
      if (page > 1) await new Promise(r => setTimeout(r, 200));
      const data = await this.request(id, `https://${host}.datapi.meteora.ag/pools?sort_by=pool_created_at:desc&page=${page}&page_size=100`);
      if (!Array.isArray(data.data)) throw new Error('Unexpected pool list format');
      for (const item of data.data) {
        const p = meteoraPool(item, route, Date.now()); if (!p) continue;
        const old = this.store.pool(p.address); overlap ||= !!old;
        if (this.store.discover(p)) added++;
        if(isDlmm(p)&&!old)this.queuePoolContext(p.mint);
        // Native metrics are useful when an exact-pair index lookup is not yet available.
        if (!old || old.metricsSource.startsWith('Meteora')) this.store.updateMetrics({ ...p,
          observedAt: old?.observedAt ?? p.observedAt, candleAt: old?.candleAt ?? null, candleAttempt: old?.candleAttempt ?? null,
          screen: old?.screen ?? p.screen }, Date.now());
      }
      if ((page >= 2 && overlap) || data.data.length < 100) break;
    }
    this.health(id, { state: overlap ? 'ok' : 'limited', detail: `${added} new context pools. Same-mint PumpSwap/Raydium lookup queued; Meteora chart screening is paused. Discovery coverage is partial.` });
    this.store.set(`${id}:observedAt`, Date.now());
  }
  private async geckoDiscovery() {
    const page = this.store.get('geckoPage', 1);
    const data = await this.request('gecko', `${GECKO}/networks/solana/new_pools?page=${page}`);
    if (!Array.isArray(data.data)) throw new Error('Unexpected new-pool response');
    let added = 0;
    for (const row of data.data) { const p = geckoPool(row, Date.now()); if (p && (inScope(p)||isDlmm(p)) && this.store.discover(p)){added++;if(isDlmm(p))this.queuePoolContext(p.mint);} }
    this.store.set('geckoPage', page >= 3 ? 1 : page + 1);
    this.health('gecko', { detail: `Indexed discovery page ${page}: ${added} target pools added. Secondary discovery is incomplete.` });
  }
  async importAddress(address: string) {
    this.store.audit('review', address, 'Manual token or pool lookup requested');
    let response = await this.request('dex', `https://api.dexscreener.com/latest/dex/pairs/solana/${address}`);
    let pairs = response.pairs ?? [];
    if (!pairs.length) {
      await new Promise(r => setTimeout(r, 200));
      response = await this.request('dex', `https://api.dexscreener.com/token-pairs/v1/solana/${address}`);
      pairs = Array.isArray(response) ? response : [];
    }
    const accepted: Pool[] = [];
    for (const row of pairs.slice(0, 20)) {
      const p = dexPool(row, Date.now()); if (!p || !inScope(p)) continue;
      p.evidence = 'Added by address; source lookup verified pool and token identity, not launch origin';
      this.store.discover(p); accepted.push(p);
    }
    if(accepted[0])this.queuePoolContext(accepted[0].mint,true);
    if (!accepted.length) throw new Error('No indexed PumpSwap or Raydium pool found for this address. Meteora monitoring is paused; bonding-curve pairs are excluded.');
    accepted.sort((a, b) => (b.liquidity ?? 0) - (a.liquidity ?? 0));
    this.queueRefresh(accepted[0].address);
    return accepted[0];
  }
  queuePoolContext(mint:string,priority=false) {
    const queue=this.store.get<{mint:string;nextAt:number;attempts:number}[]>('poolContextQueue',[]);
    if(queue.some(j=>j.mint===mint)&&!priority)return;
    const rest=queue.filter(j=>j.mint!==mint),job=queue.find(j=>j.mint===mint)??{mint,nextAt:0,attempts:0};
    this.store.set('poolContextQueue',priority?[job,...rest]:[...rest,job]);
  }
  private async resolvePoolContext() {
    const queue=this.store.get<{mint:string;nextAt:number;attempts:number}[]>('poolContextQueue',[]),job=queue.find(j=>j.nextAt<=Date.now());
    if(!job)return;
    try {
      const response=await this.request('dex',`https://api.dexscreener.com/token-pairs/v1/solana/${job.mint}`);
      if(!Array.isArray(response))throw new Error('Invalid same-mint pool lookup');
      const now=Date.now(),pools:Pool[]=[];
      for(const row of response){
        // DEX Screener prices/caps describe its base mint. Do not substitute quote-side data.
        if(row.baseToken?.address!==job.mint)continue;
        const p=dexPool(row,now,this.store.pool(row.pairAddress)??undefined);if(!p)continue;
        if(!inScope(p)&&!isDlmm(p))continue;
        this.store.discover(p);this.store.updateMetrics(p,now);pools.push(p);
      }
      const context=comparePools(job.mint,pools,now);this.store.savePoolContext(context);
      if(context.preferredPool){const p=this.store.pool(context.preferredPool)!;if(!p.candleAt)this.queueRefresh(p.address);}
      // Read current queue after the request so concurrent discoveries are not lost.
      this.store.set('poolContextQueue',this.store.get<typeof queue>('poolContextQueue',[]).flatMap(j=>j.mint!==job.mint?[j]:context.preferredPool?[]:[{...j,nextAt:Date.now()+3_600_000}]));
    } catch(error){
      if(error instanceof Deferred)return;
      this.store.set('poolContextQueue',this.store.get<typeof queue>('poolContextQueue',[]).map(j=>j.mint===job.mint?{...j,attempts:j.attempts+1,nextAt:Date.now()+Math.min(3_600_000,60_000*2**Math.min(j.attempts,6))}:j));
      this.store.audit('pool-context',job.mint,'Same-mint lookup unavailable; retry scheduled',{error:safeError(error)});
    }
  }
  queueRefresh(address: string) {
    const p = this.store.pool(address); if (!p) throw new Error('Pool not found');
    if (!inScope(p)) throw new Error('Meteora monitoring is paused. Previously collected evidence remains available.');
    this.store.savePool({ ...p, lastAttempt: 0, candleAttempt: this.candleScheduler.mode==='priority'?p.candleAttempt:0 });
    const queue = this.store.get<string[]>('refreshQueue', []);
    this.store.set('refreshQueue', [...new Set([...queue, address])]);
    this.candleScheduler.invalidate();
    this.store.audit('review', p.mint, 'Chart and metric refresh queued', { pool: address });
  }
  watchMinuteChart(address: string, now = Date.now()) {
    const pool = this.store.pool(address);
    if (!pool) throw new Error('Pool not found');
    if (!inScope(pool)) throw new Error('Meteora monitoring is paused; retained chart history is still available.');
    if (knownLowLiquidity(pool,now)) throw new Error('Pool is disregarded below $1,000 liquidity; retained candles remain available.');
    const previous = this.store.get<{ address: string; until: number } | null>('minuteChartWatch',null);
    this.store.set('minuteChartWatch',{ address, until: now + 90_000 });
    this.candleScheduler.invalidate();
    if (!previous || previous.address !== address || previous.until < now)
      this.store.audit('review',pool.mint,'One-minute chart requested',{ pool: address, collection: 'While viewed; shared free request budget' },now);
  }
  private async minuteCandles(now: number): Promise<boolean> {
    const watch = this.store.get<{ address: string; until: number } | null>('minuteChartWatch',null);
    if (!watch || watch.until < now) return false;
    const pool = this.store.pool(watch.address);
    if (!pool || !inScope(pool) || knownLowLiquidity(pool,now)) return false;
    const state = this.store.minuteChart(pool.address);
    if (state.lastAttempt !== null && now - state.lastAttempt < 60_000) return false;
    try {
      const response = await this.request('gecko',`${GECKO}/networks/solana/pools/${pool.address}/ohlcv/minute?aggregate=1&limit=1000&currency=usd&token=${pool.mint}&include_empty_intervals=false`);
      const bars = closedCandles(geckoCandles(response,pool.mint,1),Date.now(),1);
      if (!bars.length) throw new Error('No completed one-minute candles available yet');
      this.store.saveCandles(pool.address,bars,'GeckoTerminal · USD · 1m',Date.now(),1);
      this.store.set(`minuteChart:${pool.address}`,{ checkedAt: Date.now(), lastAttempt: now, issue: null });
    } catch (error) {
      if (error instanceof Deferred) return true;
      this.store.set(`minuteChart:${pool.address}`,{ ...state, lastAttempt: now, issue: safeError(error) });
    }
    return true;
  }
  metricDue(p: Pool, now: number): boolean {
    if (!inScope(p)) return false;
    if (knownLowLiquidity(p,now)) return now-(p.lastAttempt??0)>=3_600_000;
    if(this.checkRequested(p,'metrics')&&now-(p.lastAttempt??0)>=10_000)return true;
    const c = this.store.candidate(p.mint);
    const age = now - (p.createdAt ?? p.observedAt);
    const interval = age < 86_400_000 || c && !c.archived ? 60_000 : this.candleScheduler.mode==='priority'&&!c?.archived?300_000:3_600_000;
    return now - (p.lastAttempt ?? 0) >= interval;
  }
  private async metrics() {
    const now = Date.now();
    const due = this.prioritize(this.store.pools().filter(p=>this.metricDue(p,now)),'metrics',now,p=>p,
      (a,b)=>(a.lastAttempt??0)-(b.lastAttempt??0)).slice(0,30);
    if (!due.length) return;
    const data = await this.request('dex', `https://api.dexscreener.com/latest/dex/pairs/solana/${due.map(p => p.address).join(',')}`);
    this.served('metrics');
    const rows = Array.isArray(data.pairs) ? data.pairs : [];
    for (const p of due) {
      const latest = this.store.pool(p.address)!;
      const row = rows.find((r: any) => r.pairAddress === p.address);
      const updated = row ? dexPool(row, Date.now(), latest) : null;
      if (updated) {
        if (!updated.candleAt && !updated.candleAttempt) updated.screen = now - (updated.createdAt ?? 0) < 900_000 ? 'Waiting for initial candles to close'
          : 'Chart queued for background screening';
        this.store.updateMetrics(updated, Date.now());
      }
      else this.store.savePool({ ...latest, lastAttempt: now, issue: row ? 'Pair orientation differs; metrics not substituted' : 'Pair not yet available from activity index' });
    }
  }
  candleDue(p: Pool, now: number): boolean {
    if (!inScope(p)) return false;
    if (knownLowLiquidity(p,now)) return false;
    const c = this.store.candidate(p.mint);
    if (c?.archived) return false;
    if (this.store.security(p.mint).status === 'excluded') return false;
    if(this.basePriority(p,now)>0) {
      // Retry a delayed provider at most once a minute. Once the latest settled
      // five-minute close is present, wait for the next close instead of buying
      // repeated copies of the same candles with our limited request budget.
      const latestClose=Math.floor((now-30_000)/300_000)*300_000;
      return now-(p.candleAttempt??0)>=60_000&&(this.store.base(p.address)?.candleEnd??0)<latestClose;
    }
    const interval = c ? c.pinned || c.manualWatch || !c.reviewed ? 300_000 : 900_000 : 900_000;
    return now - (p.candleAttempt ?? 0) >= interval;
  }
  private async candles() {
    if(this.candleScheduler.mode==='priority') {
      await this.candleScheduler.run((url,context,onDispatch)=>this.request('gecko',url,undefined,context,onDispatch));
      return;
    }
    // Demand-driven 1m chart requests share the same scheduler and provider budget.
    // Detection continues to use the separate 5m history and original rule settings.
    if (await this.minuteCandles(Date.now())) return;
    const now = Date.now(), queue = this.store.get<string[]>('refreshQueue', []);
    const all = this.store.pools();
    const due=all.filter(p=>this.candleDue(p,now)&&now-(p.createdAt??0)>=900_000)
      .sort((a,b)=>(a.candleAttempt??a.observedAt-3_600_000)-(b.candleAttempt??b.observedAt-3_600_000));
    // Reserve every third turn for the general rotation so small-volume pools
    // get coverage even while already tracked charts need frequent updates.
    const trackedTurn=this.store.get('controlOffset',0)%3!==0;
    const priorities=new Map(due.map(p=>[p.address,this.candlePriority(p,now)]));
    const tracked=due.filter(p=>!!this.store.candidate(p.mint)).sort((a,b)=>priorities.get(b.address)!-priorities.get(a.address)!
      ||(a.candleAttempt??a.observedAt-3_600_000)-(b.candleAttempt??b.observedAt-3_600_000));
    const candidate = queue.map(a => this.store.pool(a)).find((p): p is Pool => !!p && inScope(p) && !knownLowLiquidity(p,now))
      ?? (trackedTurn?tracked[0]:undefined) ?? due[0];
    if (!candidate) return;
    try {
      const data = await this.request('gecko', `${GECKO}/networks/solana/pools/${candidate.address}/ohlcv/minute?aggregate=5&limit=1000&currency=usd&token=${candidate.mint}&include_empty_intervals=false`);
      this.store.set('controlOffset', this.store.get('controlOffset', 0) + 1);
      const candles = closedCandles(geckoCandles(data, candidate.mint), Date.now());
      if (!candles.length) throw new Error('No completed five-minute candles available yet');
      this.store.saveCandles(candidate.address, candles, 'GeckoTerminal · USD · 5m', Date.now());
      const history = this.store.candles(candidate.address);
      const signals = detectEpisodes(history, Date.now(), this.store.settings());
      const p = this.store.pool(candidate.address)!;
      const earliest = history[0].time * 1000;
      const missing = p.createdAt !== null && earliest - p.createdAt > 600_000;
      this.store.savePool({ ...p, candleAt: Date.now(), candleAttempt: now,
        screen: signals.length ? signals.at(-1)!.volumeQualified ? 'Pump + volume detected' : 'Price structure found; volume evidence incomplete'
          : history.length < 3 ? 'Waiting for more completed candles' : 'Checked: no initial pump match',
        coverage: `Candles from ${new Date(earliest).toISOString()}${missing ? '; launch history incomplete' : '; no-trade intervals omitted, indexing completeness unverified'}`, issue: null });
      this.store.recordSignals(this.store.pool(candidate.address)!, signals, Date.now());
      this.store.set('refreshQueue', queue.filter(a => a !== candidate.address));
    } catch (error) {
      if (error instanceof Deferred) return;
      const p = this.store.pool(candidate.address)!;
      this.store.savePool({ ...p, candleAttempt: now, issue: safeError(error), screen: 'Candle source unavailable; retry scheduled' });
      this.store.set('refreshQueue', queue.filter(a => a !== candidate.address));
    }
  }
  // A persisted, low-rate backward cursor supplements live candles for older coins.
  // Backfill never invents bars or historical alerts and shares the same free budget.
  private async candleHistory() {
    const now=Date.now();
    type Cursor={nextAt:number;done:boolean;pages:number;issue:string|null};
    const jobs=this.store.pools().filter(p=>inScope(p)&&p.createdAt&&p.candleAt&&!knownLowLiquidity(p,now)
      &&!this.store.candidate(p.mint)?.archived&&this.store.security(p.mint).status!=='excluded')
      .map(p=>({p,cursor:this.store.get<Cursor>(`candleHistory:${p.address}`,{nextAt:0,done:false,pages:0,issue:null})}))
      .filter(j=>!j.cursor.done&&j.cursor.nextAt<=now).sort((a,b)=>a.cursor.nextAt-b.cursor.nextAt);
    for(const {p,cursor} of jobs) {
      const history=this.store.candles(p.address), earliest=history[0]?.time;
      if(!earliest||earliest*1000-p.createdAt!<=600_000) {
        this.store.set(`candleHistory:${p.address}`,{...cursor,done:true,issue:null});continue;
      }
      try {
        const response=await this.request('gecko',`${GECKO}/networks/solana/pools/${p.address}/ohlcv/minute?aggregate=5&limit=1000&currency=usd&token=${p.mint}&include_empty_intervals=false&before_timestamp=${earliest-1}`);
        const bars=closedCandles(geckoCandles(response,p.mint),now).filter(c=>c.time<earliest);
        this.store.set(`candleHistory:${p.address}`,{nextAt:now+300_000,done:bars.length===0,pages:cursor.pages+1,issue:bars.length?null:'No earlier candles returned by this provider; launch coverage remains unverified.'});
        if(bars.length) {
          this.store.saveCandles(p.address,bars,'GeckoTerminal · USD · 5m · historical page',now);
          const full=this.store.candles(p.address), current=this.store.pool(p.address)!;
          this.store.savePool({...current,coverage:`Candles from ${new Date(full[0].time*1000).toISOString()}; ${full[0].time*1000-p.createdAt!>600_000?'launch history incomplete; backfill queued':'no-trade intervals omitted, indexing completeness unverified'}`});
          this.store.recordSignals(this.store.pool(p.address)!,detectEpisodes(full,now,this.store.settings()),now);
        }
        this.store.audit('history',p.mint,'Earlier chart history requested',{pool:p.address,before:earliest,received:bars.length,page:cursor.pages+1},now);
      }catch(error){
        if(!(error instanceof Deferred))this.store.set(`candleHistory:${p.address}`,{...cursor,nextAt:now+3_600_000,issue:safeError(error)});
      }
      return;
    }
  }
  private connectPump() {
    this.health('pump', { state: 'idle', detail: 'Connecting to free migration subscription', lastAttempt: Date.now() });
    const ws = new WebSocket('wss://pumpportal.fun/api/data', { handshakeTimeout: 12_000 }); this.socket = ws;
    let pongAt = Date.now();
    const heartbeat = setInterval(() => { if (Date.now() - pongAt > 75_000) ws.terminate(); else if (ws.readyState === WebSocket.OPEN) ws.ping(); }, 30_000);
    ws.on('pong', () => { pongAt = Date.now(); });
    ws.on('open', () => { this.socketFailures = 0; ws.send(JSON.stringify({ method: 'subscribeMigration' })); });
    ws.on('message', raw => {
      pongAt = Date.now();
      try {
        const data = JSON.parse(raw.toString());
        if (data.message) this.health('pump', { state: 'ok', lastSuccess: Date.now(), detail: 'Migration subscription acknowledged; waiting for actual migrations' });
        if (addressValid(data.mint) && (data.txType === 'migrate' || data.txType === 'migration' || data.pool === 'pump-amm')) {
          this.store.audit('migration', data.mint, 'PumpPortal migration event received', { source: 'PumpPortal', signature: data.signature ?? null, txType: data.txType ?? null, pool: data.pool ?? null });
          const jobs = this.store.get<any[]>('migrationQueue', []);
          if (!jobs.some(j => j.mint === data.mint)) this.store.set('migrationQueue', [...jobs, { mint: data.mint, source: 'PumpPortal', signature: String(data.signature ?? ''), observedAt: Date.now(), attempts: 0, nextAt: 0 }]);
          this.health('pump', { state: 'ok', lastSuccess: Date.now(), detail: 'Live migration received; destination-pool lookup queued' });
        }
      } catch { this.health('pump', { state: 'limited', detail: 'Unrecognized migration payload; not used as graduation evidence' }); }
    });
    ws.on('error', () => this.health('pump', { state: 'error', detail: 'Migration connection failed; reconnect scheduled' }));
    ws.on('close', () => {
      clearInterval(heartbeat); if (this.socket === ws) this.socket = undefined;
      this.socketRetry = Date.now() + Math.min(300_000, 5000 * 2 ** Math.min(this.socketFailures++,6));
      this.health('pump', { state: 'limited', detail: 'Disconnected; migration history during this gap may be incomplete', nextAt: this.socketRetry });
    });
  }
  private async rpc(method: string, params: unknown[]) {
    const result = await this.request('rpc', this.rpcUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    return result.result;
  }
  private async programEvidence(address: string): Promise<ProgramEvidence> {
    const cached = this.store.get<ProgramEvidence | null>(`program:${address}`, null);
    if (cached && cached.immutable !== null && fresh(cached.checkedAt, Date.now(), RISK_POLICY.controlsMaxAge)) return cached;
    await new Promise(r => setTimeout(r, 200));
    const program = await this.rpc('getAccountInfo', [address, { encoding: 'jsonParsed', commitment: 'finalized' }]);
    const dataAddress = program?.value?.data?.parsed?.info?.programData;
    let programData = null;
    if (addressValid(dataAddress)) {
      await new Promise(r => setTimeout(r, 200));
      programData = await this.rpc('getAccountInfo', [dataAddress, { encoding: 'jsonParsed', commitment: 'finalized', minContextSlot: program.context.slot }]);
    }
    // Persist projected authority evidence only, never the program binary.
    const evidence = assessProgram(address, program?.value, programData?.value, Date.now());
    this.store.set(`program:${address}`, evidence); this.store.audit('controls', address, 'Shared token program checked', evidence); return evidence;
  }
  private async tokenControls() {
    const now = Date.now(), all = this.store.pools().filter(p=>inScope(p)&&!knownLowLiquidity(p));
    const mints = [...new Set(this.prioritize(all,'controls',now,p=>p,
      (a,b)=>(this.store.security(a.mint).checkedAt??0)-(this.store.security(b.mint).checkedAt??0)).map(p=>p.mint))];
    const forced=new Set(all.filter(p=>this.checkRequested(p,'controls')).map(p=>p.mint));
    const due = mints.filter(mint => {
      const check = this.store.security(mint);
      return forced.has(mint)||check.supplyRaw===undefined || check.decimals===undefined || check.policyVersion !== RISK_POLICY.version || !fresh(check.checkedAt, now, check.status === 'passed' ? 23 * 3_600_000 : check.status === 'excluded' ? 3_600_000 : 60_000);
    }).slice(0,50);
    if (!due.length) return;
    try {
      const response = await this.rpc('getMultipleAccounts', [due, { encoding: 'jsonParsed', commitment: 'finalized' }]);
      this.served('controls');
      if (!Array.isArray(response?.value) || response.value.length !== due.length || !Number.isSafeInteger(response.context?.slot)) throw new Error('Invalid mint account response');
      const programs = new Map<string, ProgramEvidence>();
      for (const owner of new Set<string>(response.value.map((a: any) => a?.owner)))
        if ([TOKEN, TOKEN_2022].includes(owner)) programs.set(owner, await this.programEvidence(owner));
      this.store.transaction(() => due.forEach((mint,i) => this.store.saveSecurity(assessMint(mint, response.value[i], programs.get(response.value[i]?.owner) ?? null, Date.now(), response.context.slot))));
      this.health('controls', { state: 'ok', lastSuccess: Date.now(), detail: 'Finalized mint/freeze authorities, extensions and shared program upgrade status checked. Metadata and transfer-fee configurations are allowed.' });
    } catch (error) {
      if (error instanceof Deferred) throw error;
      for (const mint of due) this.store.saveSecurity({ ...pendingSecurity(mint, 'On-chain controls unavailable; retry scheduled'), checkedAt: now });
      this.health('controls', { state: 'error', detail: 'Token-control verification failed; unverified coins stay out of the active watchlist' });
      throw error;
    }
  }
  queueSupplyProof(address: string, signature: string) {
    const pool=this.store.pool(address);
    if(!pool||!inScope(pool))throw new Error('An active-scope pool is required');
    if(!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature))throw new Error('Enter a Solana transaction signature');
    const previous=this.store.get<SupplySearch>(`supplySearch:${pool.mint}`,{pages:0,probes:[],exhausted:false,nextAt:0,issue:''});
    this.store.set(`supplySearch:${pool.mint}`,{...previous,signature,nextAt:0,issue:'Creation transaction queued for on-chain supply verification'});
    this.store.audit('review',pool.mint,'Starting-supply proof lookup requested',{signature});
  }
  private originPools() {
    return this.store.pools().filter(p=>inScope(p)&&!knownLowLiquidity(p)&&addressValid(p.mint)&&addressValid(p.quoteMint)
      &&this.store.candidate(p.mint)?.pool===p.address&&!this.store.candidate(p.mint)?.archived
      &&this.store.security(p.mint).status==='passed');
  }
  private async launchOrigins() {
    const now=Date.now();
    const due=this.prioritize(this.originPools().filter(p=>{
      const old=this.store.get<LaunchOrigin|null>(`launchOrigin:${p.mint}`,null);
      const attempt=this.store.get<{nextAt:number;version:string}|null>(`launchLookup:${p.mint}`,null);
      return !(old?.version===LAUNCH_ORIGIN_VERSION&&old.graduated)&&(!attempt||attempt.version!==LAUNCH_ORIGIN_VERSION||now>=attempt.nextAt);
    }),'supply',now,p=>p,(a,b)=>a.observedAt-b.observedAt).slice(0,12);
    if(!due.length)return;
    const plans=await Promise.all(due.map(async pool=>{
      // API records are address hints only; the program-owned account proves origin.
      const hint=this.store.get<{quoteMint:string}|null>(`stonkHint:${pool.mint}`,null);
      const old=this.store.get<LaunchOrigin|null>(`launchOrigin:${pool.mint}`,null);
      const quoteMint=hint?.quoteMint??old?.quoteMint??pool.quoteMint;
      return {pool,quoteMint,...await launchAddresses(pool.mint,quoteMint)};
    }));
    const addresses=plans.flatMap(p=>[p.pump,p.pumpDestination,p.ray]);
    const response=await this.rpc('getMultipleAccounts',[addresses,{encoding:'base64',commitment:'finalized'}]);
    if(!Array.isArray(response?.value)||response.value.length!==addresses.length||!Number.isSafeInteger(response.context?.slot))throw new Error('Invalid launch-account batch response');
    for(let i=0;i<plans.length;i++) {
      const p=plans[i],controls=this.store.security(p.pool.mint),values=response.value.slice(i*3,i*3+3);
      const origin=await parsePumpOrigin(p.pool.mint,p.pump,values[0],values[1]?{...values[1],address:p.pumpDestination}:null,controls,response.context.slot,now)
        ??await parseLaunchLabOrigin(p.pool.mint,p.quoteMint,p.ray,values[2],controls,response.context.slot,now);
      this.store.transaction(()=>{
        this.store.set(`launchLookup:${p.pool.mint}`,{checkedAt:now,nextAt:now+(origin&&!origin.graduated?300_000:86_400_000),version:LAUNCH_ORIGIN_VERSION,
          issue:origin?'Launch origin verified':'No supported launch record found; origin remains unverified'});
        if(origin){
          this.store.set(`launchOrigin:${origin.mint}`,origin);
          this.store.audit('origin',origin.mint,'Launch platform and graduation checked',origin,now);
          const proof=launchSupply(origin),saved=this.store.supplyOrigin(origin.mint);
          // Keep stronger existing transaction evidence; log any disagreement for review.
          if(proof&&!saved)this.store.saveSupplyOrigin(proof);
          else if(proof&&saved&&(proof.raw!==saved.raw||proof.decimals!==saved.decimals))this.store.audit('origin',origin.mint,'Launch supply conflicts with saved issuance proof',{saved,launch:proof},now);
        }else this.store.audit('origin',p.pool.mint,'Launch lookup returned no verified match',{accounts:[p.pump,p.ray],slot:response.context.slot},now);
      });
    }
  }
  private async stonkOriginHints() {
    const now=Date.now(),pool=this.prioritize(this.originPools().filter(p=>p.venue==='Raydium'
      &&!this.store.get<LaunchOrigin|null>(`launchOrigin:${p.mint}`,null)
      &&now>=this.store.get<number>(`stonkLookupNext:${p.mint}`,0)),'supply',now,p=>p,(a,b)=>a.observedAt-b.observedAt)[0];
    if(!pool)return;
    let response:any;
    try{response=await this.request('stonk',`https://www.stonkfun.xyz/api/public/v1/tokens/${pool.mint}`);}
    catch(error){if(!(error instanceof Deferred))this.store.set(`stonkLookupNext:${pool.mint}`,now+600_000);throw error;}
    if(!response?.data||!('token' in response.data))throw new Error('Invalid StonkFun token index response');
    const row=response.data.token;
    const token=row?.mint===pool.mint&&row.launchpad==='launchlab'&&addressValid(row.quote?.mint)?row:null;
    this.store.set(`stonkLookupNext:${pool.mint}`,now+86_400_000);
    if(token){
      this.store.set(`stonkHint:${pool.mint}`,{quoteMint:token.quote.mint,checkedAt:now,source:'StonkFun public token index'});
      this.store.set(`launchLookup:${pool.mint}`,{nextAt:0,version:LAUNCH_ORIGIN_VERSION});
      this.store.audit('origin',pool.mint,'StonkFun launch hint found; on-chain confirmation queued',{quoteMint:token.quote.mint},now);
    }
  }
  private async supplyOrigins() {
    const now=Date.now(), pools=this.store.pools().filter(p=>inScope(p)&&!knownLowLiquidity(p));
    // History is a fallback for charts worth reviewing, never a crawl of every discovery.
    const mints=[...new Set(pools.filter(p=>this.verificationPriority(p,'supply',now)>0||this.store.get<SupplySearch|null>(`supplySearch:${p.mint}`,null)?.signature).map(p=>p.mint))];
    const due=mints.filter(m=>this.store.security(m).status==='passed'&&this.store.supply(m,now).status==='pending'
      &&(!addressValid(m)||this.store.get(`launchLookup:${m}`,null)||this.store.get<SupplySearch|null>(`supplySearch:${m}`,null)?.signature))
      .map(mint=>({mint,state:this.store.get<SupplySearch>(`supplySearch:${mint}`,{pages:0,probes:[],exhausted:false,nextAt:0,issue:'Looking for initial token issuance'}),
        firstSeen:this.store.candidate(mint)?.qualifiedAt??now}))
      .filter(({state:s})=>now>=s.nextAt&&(!s.exhausted||!!s.probes.length||!!s.signature||(s.parserVersion!==SUPPLY_PARSER_VERSION&&!!s.before)))
      .sort((a,b)=>(a.state.nextAt||a.firstSeen)-(b.state.nextAt||b.firstSeen)||a.mint.localeCompare(b.mint));
    // Explicit proof requests retain precedence. Otherwise reserve every third
    // completed turn for oldest-due work so background checks cannot starve.
    const job=due.find(j=>j.state.signature)??this.prioritize(due,'supply',now,
      j=>pools.find(p=>p.mint===j.mint&&this.checkRequested(p,'supply'))??pools.find(p=>p.address===this.store.candidate(j.mint)?.pool),
      (a,b)=>(a.state.nextAt||a.firstSeen)-(b.state.nextAt||b.firstSeen)||a.mint.localeCompare(b.mint))[0];
    if(!job)return;
    const {mint,state}=job, key=`supplySearch:${mint}`;
    const parserUpdated=state.parserVersion!==SUPPLY_PARSER_VERSION;
    // Revisit the oldest known transaction once after a parser correction, preserving the expensive history cursor.
    if(parserUpdated&&state.exhausted&&state.before)state.probes=[...new Set([state.before,...state.probes])].slice(0,12);
    state.parserVersion=SUPPLY_PARSER_VERSION;
    if(state.exhausted&&!state.probes.length&&!state.signature)return;
    try {
      if(state.signature||state.exhausted) {
        const signature=state.signature??state.probes[0];
        const tx=await this.rpc('getTransaction',[signature,{encoding:'jsonParsed',commitment:'finalized',maxSupportedTransactionVersion:MAX_TRANSACTION_VERSION}]);
        state.lastAttempt=Date.now();
        this.served('supply');
        if(!tx)throw new Error('Creation transaction unavailable from the current RPC');
        const origin=parseSupplyOrigin(mint,signature,tx,this.store.security(mint),Date.now());
        if(origin)this.store.saveSupplyOrigin(origin);
        else {
          state.issue=state.pages>=20?'Starting supply unverified: the 20,000-signature search limit was reached; a creation transaction is needed':'Starting supply remains unverified: no complete initialization and issuance proof found';
          this.store.audit('supply',mint,'Transaction checked; initial issuance not proven',{signature,slot:tx.slot??null,parserVersion:SUPPLY_PARSER_VERSION,reason:state.issue});
        }
        if(state.signature)delete state.signature;else state.probes.shift();
        state.nextAt=now+6000;
      } else {
        const rows=await this.rpc('getSignaturesForAddress',[mint,{limit:1000,...(state.before?{before:state.before}:{}),commitment:'finalized'}]);
        state.lastAttempt=Date.now();
        this.served('supply');
        if(!Array.isArray(rows)||rows.some((r:any)=>typeof r.signature!=='string'))throw new Error('Invalid supply-history response');
        if(rows.length&&rows.at(-1).signature===state.before)throw new Error('Supply-history cursor did not advance');
        state.pages++;
        if(rows.length){state.before=rows.at(-1).signature;state.probes=[...rows.filter((r:any)=>r.err===null).slice(-12).reverse().map((r:any)=>r.signature),...state.probes].slice(0,12);}
        state.exhausted=rows.length<1000||state.pages>=20;
        state.issue=state.exhausted?(rows.length===1000&&state.pages>=20?'History search limit reached; checking the oldest transactions retrieved':'Checking oldest available transactions for initial issuance'):`Starting supply pending: searched ${state.pages} page(s) of transaction history`;
        state.nextAt=now+30_000;
        this.store.audit('supply',mint,'Starting-supply history searched',{pages:state.pages,before:state.before,exhausted:state.exhausted,signatures:rows.length,limitReached:state.pages>=20},now);
      }
      if(parserUpdated)this.store.audit('supply',mint,'Starting-supply parser updated; existing history cursor retained',{parserVersion:SUPPLY_PARSER_VERSION,oldestTransaction:state.before??null});
      this.store.set(key,state);
    } catch(error) {
      if(error instanceof Deferred)return;
      state.lastAttempt=Date.now();
      state.nextAt=now+120_000;state.issue='Starting-supply history unavailable; retry scheduled. Coin withheld until verified.';
      this.store.set(key,state);this.store.audit('supply',mint,state.issue,{error:safeError(error)},now);
    }
  }
  private async liquidityProtection() {
    const primary=(p:Pool)=>this.store.poolContext(p.mint)?.preferredPool===p.address||this.store.candidate(p.mint)?.pool===p.address;
    const now=Date.now(), due=this.store.pools().filter(p=>inScope(p)&&!knownLowLiquidity(p,now)&&!this.store.candidate(p.mint)?.archived
      &&(this.store.candidate(p.mint)?.pool===p.address||this.checkRequested(p,'protection')))
      .filter(p=>{const e=this.store.protection(p,now);return this.checkRequested(p,'protection')||!fresh(e.checkedAt,now,e.status==='passed'?600_000:300_000);});
    const pool=this.prioritize(due,'protection',now,p=>p,
      (a,b)=>(this.store.protection(a,now).checkedAt??0)-(this.store.protection(b,now).checkedAt??0)||Number(primary(b))-Number(primary(a)))[0];
    if(!pool)return;
    try {
      const initial=await this.rpc('getAccountInfo',[pool.address,{encoding:'base64',commitment:'finalized'}]);
      this.served('protection');
      const decoded=decodeLiquidityPool(pool,initial?.value);
      if(!decoded){this.store.saveProtection({...pendingProtection(pool,'Pool owner/layout or token identities are unverified. This adapter supports PumpSwap and Raydium CPMM; other layouts remain pending.'),checkedAt:now});return;}
      let lockAddresses:string[]=[], minSlot=initial.context.slot;
      if(decoded.program===RAY_CPMM){
        await new Promise(r=>setTimeout(r,200));
        const locks=await this.rpc('getTokenAccountsByOwner',[RAY_LOCK_AUTH,{mint:decoded.lpMint},{encoding:'jsonParsed',commitment:'finalized',minContextSlot:minSlot}]);
        if(!Array.isArray(locks?.value))throw new Error('LP lock accounts unavailable');
        lockAddresses=locks.value.map((v:any)=>v.pubkey);minSlot=locks.context.slot;
        if(lockAddresses.length>90)throw new Error('LP lock inventory exceeds this adapter limit');
      }
      await new Promise(r=>setTimeout(r,200));
      const response=await this.rpc('getMultipleAccounts',[[pool.address,decoded.lpMint,...lockAddresses],{encoding:'jsonParsed',commitment:'finalized',minContextSlot:minSlot}]);
      const rows=response?.value, slot=response?.context?.slot;
      if(!Array.isArray(rows)||rows.length!==lockAddresses.length+2||!Number.isSafeInteger(slot))throw new Error('Invalid LP account snapshot');
      const current=decodeLiquidityPool(pool,rows[0]);
      if(!current||current.lpMint!==decoded.lpMint)throw new Error('LP pool identity changed between observations');
      this.store.saveProtection(assessProtection(pool,current,rows[1],rows.slice(2),slot,Date.now()));
    }catch(error){if(error instanceof Deferred)return;this.store.saveProtection({...pendingProtection(pool,'Liquidity lock/burn verification unavailable; pending, not a confirmed liquidity pull'),checkedAt:now,reasons:['Liquidity lock/burn verification unavailable; pending, not a confirmed liquidity pull',safeError(error)]});}
  }
  private async quote(inputMint: string, outputMint: string, amount: string) {
    const params = new URLSearchParams({ inputMint, outputMint, amount });
    // No taker, wallet, transaction builder or execution request. Quote-only response.
    const data = await this.request('quotes', `https://api.jup.ag/swap/v2/order?${params}`, {
      headers: process.env.JUPITER_API_KEY ? { 'x-api-key': process.env.JUPITER_API_KEY } : {},
    });
    return parseQuote(data, inputMint, outputMint, amount, Date.now());
  }
  private tradingAttemptAt(pool: Pool) {
    return this.store.get<number|null>(`tradingAttempt:${pool.address}`,null)??this.store.trading(pool).checkedAt;
  }
  private tradingDueAt(pool: Pool) {
    const attempted=this.tradingAttemptAt(pool);
    const requested=this.store.get<number>(`checkRefresh:${pool.address}`,0);
    return requested>(attempted??0)?0:attempted===null?0:attempted+120_000;
  }
  // The UI reads the same scope, prerequisites and priority gates as the quote queue.
  // A price refresh never changes these timestamps or makes a held check "queued".
  tradingProgress(pool: Pool, now=Date.now()): TradingProgress {
    const t=this.store.trading(pool),c=this.store.candidate(pool.mint),controls=this.store.security(pool.mint);
    const common={lastAttemptAt:this.tradingAttemptAt(pool),lastQuoteAt:t.buy&&t.sell?Math.min(t.buy.receivedAt,t.sell.receivedAt):null,nextAttemptAt:null};
    const result=(state:TradingProgress['state'],reason:string,nextAttemptAt:number|null=null):TradingProgress=>({...common,state,reason,nextAttemptAt});
    if(!inScope(pool)||c?.archived||c?.researchTags?.includes('not_matching')||knownLowLiquidity(pool,now))
      return result('inactive','Trading checks are inactive for archived or out-of-scope pools and pools below the liquidity floor.');
    if(!this.running)return result('paused','Resume the scanner to run trading checks.');
    if(this.tradingPool===pool.address)return result('checking','Requesting a buy quote and matching reverse sell quote.');
    if(controls.status!=='passed'||!fresh(controls.checkedAt,now,RISK_POLICY.controlsMaxAge))
      return result('waiting_controls','Trading checks wait for current token-control verification.');
    if(t.policyVersion===RISK_POLICY.version&&t.status!=='pending'&&fresh(t.checkedAt,now,RISK_POLICY.quoteMaxAge)
      &&fresh(t.buy?.receivedAt??null,now,RISK_POLICY.quoteMaxAge)&&fresh(t.sell?.receivedAt??null,now,RISK_POLICY.quoteMaxAge)
      &&!this.checkRequested(pool,'trading'))return result('current','Both quote results are current.');
    if((c?.pool!==pool.address&&!this.checkRequested(pool,'trading'))||this.verificationPriority(pool,'trading',now)===0)
      return result('waiting_setup','Price and chart observations continue. Trading checks run when a setup develops, you follow the coin, or you request Recheck.');
    const liquidity=assessLiquidity(pool,now);
    if(liquidity.status!=='passed')return result('waiting_liquidity',liquidity.reasons.join(' '));
    const cooldown=this.store.get<number>('providerCooldown:quotes',0);
    if(cooldown>now)return result('rate_limited','Jupiter has asked the scanner to wait. The trading check remains scheduled.',cooldown);
    if(this.store.countRequests('quotes',now-60_000)>=limits.quotes)
      return result('rate_limited','The quote request budget is in use. The trading check remains scheduled.');
    const dueAt=this.tradingDueAt(pool);
    if(dueAt>now)return result('retry_wait','The last attempt did not produce a complete current result. A retry is scheduled.',dueAt);
    return result('queued','Waiting for a quote-check turn; followed charts, requested checks and promising setups receive priority.');
  }
  private async tradeability() {
    const now = Date.now();
    const due = this.store.pools().filter(p=>inScope(p)&&!knownLowLiquidity(p,now)&&!this.store.candidate(p.mint)?.archived
      &&(this.store.candidate(p.mint)?.pool===p.address||this.checkRequested(p,'trading'))&&this.verificationPriority(p,'trading',now)>0)
      .map(poolData=>({poolData,risk:this.store.risk(poolData,now)}))
      .filter(c=>c.risk.controls.status==='passed'&&fresh(c.risk.controls.checkedAt,now,RISK_POLICY.controlsMaxAge)
        &&this.tradingDueAt(c.poolData)<=now);
    const candidate=this.prioritize(due,'trading',now,c=>c.poolData,
      (a,b)=>(a.risk.trading.checkedAt??0)-(b.risk.trading.checkedAt??0))[0];
    if (!candidate) return;
    const pool = candidate.poolData, liquidity = assessLiquidity(pool, now);
    if (liquidity.status !== 'passed') {
      this.store.saveTrading({ ...pendingTrading(pool), status: liquidity.status, checkedAt: now, reasons: liquidity.reasons }); return;
    }
    let buy: QuoteEvidence | null = null;
    this.tradingPool=pool.address;
    this.store.set(`tradingAttempt:${pool.address}`,now);
    try {
      buy = await this.quote(USDC, pool.mint, RISK_POLICY.sampleUsdcRaw);
      this.served('trading');
      const sell = await this.quote(pool.mint, USDC, buy.outAmount);
      this.store.saveTrading(assessTrading(this.store.pool(pool.address)!, buy, sell, Date.now()));
    } catch (error) {
      if (error instanceof Deferred) {
        // Budget deferrals are not completed checks. Keep the request pending,
        // while a bounded retry prevents a failed explicit check from hot-looping.
        throw error;
      }
      this.store.saveTrading({ ...pendingTrading(pool, 'Buy/sell route could not be verified; source unavailable, unsupported route or invalid quote. Retry scheduled.'), checkedAt: now, buy });
    } finally { this.tradingPool=null; }
  }
  private async raydium() {
    const signers = (process.env.RAYDIUM_MIGRATION_SIGNERS || 'RAYpQbFNq9i3mu6cKpTKKRwwHFDeK5AuZz8xvxUrCgw').split(',').filter(addressValid);
    const index = this.store.get('raySignerIndex', 0) % Math.max(1, signers.length), signer = signers[index];
    if (!signer) return;
    const cursor = this.store.get<string | null>(`rayCursor:${signer}`, null);
    const rows = await this.rpc('getSignaturesForAddress', [signer, { limit: 20, ...(cursor ? { until: cursor } : {}), commitment: 'confirmed' }]);
    if (!Array.isArray(rows)) throw new Error('Invalid migration signature response');
    const pending = this.store.get<any[]>('rayPending', []);
    for (const r of [...rows].reverse()) if (!r.err && !pending.some(j => j.signature === r.signature)) pending.push({ signature: r.signature, attempts: 0 });
    this.store.transaction(() => {
      this.store.set('rayPending', pending);
      if (rows[0]) this.store.set(`rayCursor:${signer}`, rows[0].signature);
      this.store.set('raySignerIndex', index + 1);
      this.store.audit('migration', signer, 'Migration signatures reconciled', { count: rows.length, previousCursor: cursor, nextCursor: rows[0]?.signature ?? cursor, pending: pending.length, possibleGap: rows.length === 20 });
    });
    if (rows.length === 20) this.health('rpc', { state: 'limited', detail: 'Migration history page was full; gap may remain beyond the bounded cursor page' });
    // The cursor advances only after durable pending work is saved. Failed fetches stay pending.
    if (!pending.length) return;
    await new Promise(r => setTimeout(r, 200));
    const job = pending[0];
    const tx = await this.rpc('getTransaction', [job.signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: MAX_TRANSACTION_VERSION, commitment: 'confirmed' }]);
    if (!tx) return;
    if (!tx.meta?.err && tx.meta?.logMessages?.some((line: string) => line.includes('Instruction: MigrateToCpswap') || line.includes('Instruction: MigrateToAmm'))) {
      const mints = [...new Set<string>((tx.meta.postTokenBalances ?? []).map((b: any) => b.mint))].filter(m => m !== SOL && addressValid(m));
      const accounts = (tx.transaction?.message?.accountKeys ?? []).map((a: any) => typeof a === 'string' ? a : a.pubkey);
      const migrations = this.store.get<any[]>('migrationQueue', []);
      for (const mint of mints.slice(0,4)) if (!migrations.some(j => j.mint === mint)) migrations.push({ mint, source: 'LaunchLab signer', signature: job.signature, accounts, observedAt: Date.now(), attempts: 0, nextAt: 0 });
      this.store.set('migrationQueue', migrations);
    }
    this.store.set('rayPending', pending.slice(1));
  }
  private async resolveMigrations() {
    const jobs = this.store.get<any[]>('migrationQueue', []), job = jobs.find(j => j.nextAt <= Date.now());
    if (!job) return;
    const rows = await this.request('dex', `https://api.dexscreener.com/token-pairs/v1/solana/${job.mint}`);
    let found = false;
    for (const row of Array.isArray(rows) ? rows : []) {
      const p = dexPool(row, Date.now());
      if (!p || p.mint !== job.mint || (job.source === 'PumpPortal' ? p.venue !== 'PumpSwap' : p.venue !== 'Raydium' || !job.accounts?.includes(p.address))) continue;
      p.origin = job.source === 'PumpPortal' ? 'Pump graduation reported' : 'LaunchLab migration observed';
      p.evidence = `${job.source}: ${job.signature}. ${job.source === 'PumpPortal' ? 'Destination selected from indexed PumpSwap pools; canonical pool not decoded.' : 'Destination address appears in successful migration transaction.'}`;
      const old = this.store.pool(p.address);
      this.store.discover(p); this.store.savePool({ ...(old ?? p), origin: p.origin, evidence: p.evidence }); found = true;
      this.store.audit('migration', p.mint, 'Migration destination resolved', { pool: p.address, origin: p.origin, evidence: p.evidence });
    }
    // Retain unresolved migrations for audit/retry; no silent expiry.
    this.store.set('migrationQueue', jobs.flatMap(j => j.mint !== job.mint ? [j] : found ? [] : [{ ...j, attempts: j.attempts + 1, nextAt: Date.now() + Math.min(3_600_000, 30_000 * 2 ** Math.min(j.attempts,7)) }]));
  }
}
function safeError(error: unknown): string {
  if (error instanceof Error && /HTTP|Provider response|Candle|candle|token identity|OHLCV/.test(error.message)) return error.message.slice(0,200);
  return 'Source request failed or timed out; retry scheduled';
}
