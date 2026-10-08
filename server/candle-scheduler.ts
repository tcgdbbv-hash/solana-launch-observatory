import type { Pool } from '../shared/types.ts';
import { CANDLE_SHARES, CANDLE_LABELS, CANDLE_PROFILES, type CandleProfile, type CandleMode, type CandleClass, type CandleJob, type CandleReport } from '../shared/candle-policy.ts';
import { inScope } from '../shared/scope.ts';
import { knownLowLiquidity } from '../shared/liquidity.ts';
import { BASE_VERSION, BASE_MAX_AGE } from '../shared/base.ts';
import { earlySignsRefreshEligible } from '../shared/shortlist.ts';
import { extremeDrawdown } from '../shared/drawdown.ts';
import { closedCandles, detectEpisodes } from './detector.ts';
import { geckoCandles } from './providers.ts';
import { Deferred } from './provider-error.ts';
import { Store } from './store.ts';

const hour=3_600_000, classes=Object.keys(CANDLE_SHARES) as CandleClass[];
const GECKO='https://api.geckoterminal.com/api/v2';
export interface CandleRequestContext { jobId:string; purpose:string; queueClass:CandleClass; pool:string; mint:string; minutes:1|5; mode:'priority'; }
type Request=(url:string,context:CandleRequestContext,onDispatch:()=>void)=>Promise<any>;
type HistoryCursor={nextAt:number;done:boolean;pages:number;issue:string|null};

export class CandleScheduler {
  private plannedAt=0;
  private busy=false;
  constructor(private store:Store,private basePriority:(p:Pool,now:number)=>number) {
    // An interrupted request keeps its persisted budget use and retry delay.
    for(const job of store.candleJobs())if(job.state==='running')store.saveCandleJob({...job,state:'queued',nextAt:Math.max(job.nextAt,Date.now()+60_000)});
    store.db.prepare("UPDATE candle_runs SET data=json_set(data,'$.outcome','interrupted','$.finishedAt',?) WHERE json_extract(data,'$.outcome')='in-flight'")
      .run(Date.now());
  }
  get mode():CandleMode { return this.store.get<CandleMode>('candleSchedulerMode','legacy'); }
  get profile():CandleProfile { return this.store.get<string>('candlePriorityProfile','balanced')==='discovery'?'discovery':'balanced'; }
  private get policy() { return CANDLE_PROFILES[this.profile]; }
  setProfile(profile:CandleProfile,now=Date.now()) {
    const previous=this.profile;if(previous===profile)return;
    const before=this.report(now);
    this.store.transaction(()=>{
      this.store.set('candleProfileBaseline',{at:now,minutes:Math.max(1,Math.round((now-before.since)/60_000)),
        attempts:before.attempts,firstChecks:before.firstChecks,firstWaiting:before.queue.first,firstWaitMs:before.firstWaitMs});
      this.store.set('candlePriorityProfile',profile);this.store.set('candleProfileChangedAt',now);
      this.store.set('candleWeightedTurn',0);
      this.store.audit('settings','candle-scheduler','Candle request balance changed',
        {previous,profile,version:this.policy.version,shares:this.policy.shares,
          preserved:'Detector thresholds, screening rules, charts, feedback, evidence and provider retry delays'},now);
    });
    this.invalidate();
  }
  setMode(mode:CandleMode,now=Date.now()) {
    const previous=this.mode;
    if(previous===mode)return;
    this.store.transaction(()=>{
      if(mode==='priority'&&!this.store.get('candleTrialStartedAt',0)) {
        const rows=this.store.db.prepare("SELECT data FROM audit WHERE entity='gecko' AND category='request' AND time>=?").all(now-hour);
        const responses=rows.map(r=>JSON.parse(String(r.data))).filter(r=>r.httpStatus&&r.operation?.includes('/ohlcv/'));
        this.store.set('candleTrialBaseline',{at:now,minutes:60,attempts:responses.length,successes:responses.filter(r=>r.httpStatus===200).length,limited:responses.filter(r=>r.httpStatus===429).length});
        this.store.set('candleTrialStartedAt',now);
      }
      this.store.set('candleSchedulerMode',mode);this.store.set('candleSchedulerChangedAt',now);
      this.store.audit('settings','candle-scheduler',mode==='priority'?'Prioritised candle scheduling enabled':'Previous candle scheduling restored',
        {previous,mode,profile:this.profile,version:this.policy.version,shares:this.policy.shares,preserved:'All charts, feedback, detector thresholds and screening evidence'},now);
    });
    this.plannedAt=0;
  }
  invalidate(){this.plannedAt=0;}
  private eligible(p:Pool,now:number) {
    const c=this.store.candidate(p.mint);
    return inScope(p)&&!knownLowLiquidity(p,now)&&!c?.archived&&!c?.researchTags?.includes('not_matching')
      &&this.store.security(p.mint).status!=='excluded';
  }
  plan(now=Date.now(),force=false):CandleJob[] {
    if(!force&&now-this.plannedAt<30_000)return this.store.candleJobs();
    this.plannedAt=now;
    const discovery=this.profile==='discovery';
    const candidates=discovery?new Map(this.store.candidates(now).map(c=>[c.mint,c])):null;
    const pools=this.store.pools(),eligible=pools.filter(p=>this.eligible(p,now));
    const byMint=new Map<string,Pool[]>();
    for(const p of eligible)byMint.set(p.mint,[...(byMint.get(p.mint)??[]),p]);
    const primary=[...byMint.values()].map(rows=>{
      const preferred=this.store.poolContext(rows[0].mint)?.preferredPool;
      return rows.find(p=>p.address===preferred)??rows.sort((a,b)=>(b.liquidity??-1)-(a.liquidity??-1)||a.address.localeCompare(b.address))[0];
    });
    const bounds=new Map(this.store.db.prepare('SELECT pool,MIN(time) AS first,MAX(time) AS last FROM candles GROUP BY pool').all().map(r=>[String(r.pool),{first:Number(r.first),last:Number(r.last)}]));
    const old=new Map(this.store.candleJobs().map(j=>[j.id,j]));
    const wanted=new Set<string>(),requested=this.store.get<string[]>('refreshQueue',[]),fulfilled=new Set<string>();
    const add=(p:Pool,kind:CandleJob['kind'],queue:CandleClass,reason:string,score:number,dueAt:number,before?:number,refreshBy?:number)=>{
      const id=`${p.address}:${kind}`,prior=old.get(id);wanted.add(id);
      if(prior?.state==='running')return;
      const job:CandleJob={id,pool:p.address,mint:p.mint,kind,class:queue,reason,score,dueAt,
        enqueuedAt:prior?.state==='queued'?prior.enqueuedAt:now,state:'queued',lastAttempt:prior?.lastAttempt??null,
        failures:prior?.failures??0,nextAt:prior?.nextAt??0,...(before!==undefined?{before}:{}),...(refreshBy!==undefined?{refreshBy}:{})};
      this.store.saveCandleJob(job);
    };
    const latestClose=Math.floor((now-30_000)/300_000)*300_000;
    for(const p of primary) {
      const b=bounds.get(p.address),base=this.store.base(p.address),profile=this.store.snapshotScreen(p.address),c=this.store.candidate(p.mint);
      const recentlyQualified=base?.version===BASE_VERSION&&base.status==='qualified'&&base.candleEnd!==null&&now-base.candleEnd<24*hour;
      const snapshotPromising=profile?.promising&&now-profile.at<=10*60_000;
      const held=extremeDrawdown(this.store.drawdown(p,now));
      const developing=this.basePriority(p,now)>0;
      const established=!held&&(recentlyQualified||developing);
      const row=candidates?.get(p.mint);
      const early=!!row&&row.pool===p.address&&earlySignsRefreshEligible(row,now);
      const promising=!held&&(established||snapshotPromising);
      const queue:CandleClass=!b?'first':established?'promising':early?'early':promising?'promising':'revisit';
      const prior=old.get(`${p.address}:latest`),last=Math.max(prior?.lastAttempt??0,p.candleAttempt??0);
      const followed=c?.manualWatch||c?.pinned;
      const interval=discovery
        ?established?300_000:early?600_000:followed?900_000:promising?1_200_000:c?1_800_000:!profile?.hours?hour:3*hour
        :promising?300_000:followed?900_000:c?1_800_000:!profile?.hours?hour:3*hour;
      const dueAt=Math.max((p.createdAt??p.observedAt)+900_000,last?last+interval:0);
      let reason=!b?'First look at available chart history':recentlyQualified?'Refresh a recently qualified base'
        :developing?'Check a developing base':early?now-base!.candleEnd!>BASE_MAX_AGE
          ?'Reassess expired Early signs evidence':'Refresh Early signs before chart evidence expires':snapshotPromising?profile!.reasons.join('. ')
        :'Scheduled quiet-chart reassessment; no fresh pump required';
      if(held&&b)reason='Extreme retracement; background reassessment or your followed chart';
      if(requested.includes(p.address))reason='Requested chart refresh within the shared budget';
      const cached=b&&(b.last+300)*1000>=latestClose;
      if(cached&&requested.includes(p.address))fulfilled.add(p.address);
      const score=discovery?(queue==='first'||queue==='early'||queue==='revisit'?0:(profile?.score??0)+(established?60:0))
        :queue==='revisit'?0:(profile?.score??0)+(recentlyQualified?20:0);
      if(!cached)add(p,'latest',queue,reason,score,
        requested.includes(p.address)?Math.max(last+60_000,(p.createdAt??p.observedAt)+900_000):dueAt,undefined,
        discovery&&early&&base?.candleEnd!=null?base.candleEnd+BASE_MAX_AGE:undefined);

      const cursor=this.store.get<HistoryCursor>(`candleHistory:${p.address}`,{nextAt:0,done:false,pages:0,issue:null});
      // Older data is fetched only when it can answer a current evidence gap.
      if(b&&p.createdAt&&b.first*1000-p.createdAt>600_000&&!cursor.done&&(promising||c?.manualWatch||c?.pinned||requested.includes(p.address))
        &&(!base||base.status==='insufficient'||!this.store.episodes(p.mint).some(e=>e.pool===p.address)))
        add(p,'history','support','Fill missing launch history for this chart assessment',0,Math.max(cursor.nextAt,old.get(`${p.address}:history`)?.nextAt??0),b.first-1);
    }
    // An explicit request for a secondary pool is allowed, but never bypasses exclusions or quotas.
    for(const address of requested)if(!primary.some(p=>p.address===address)) {
      const p=eligible.find(p=>p.address===address);if(!p){fulfilled.add(address);continue;}
      const b=bounds.get(address),last=old.get(`${address}:latest`)?.lastAttempt??p.candleAttempt??0;
      if(b&&(b.last+300)*1000>=latestClose)fulfilled.add(address);
      else add(p,'latest','support','Requested inspection of this specific pool',0,Math.max(last+60_000,(p.createdAt??p.observedAt)+900_000));
    }
    const watch=this.store.get<{address:string;until:number}|null>('minuteChartWatch',null);
    if(watch&&watch.until>now) {
      const p=eligible.find(p=>p.address===watch.address);
      if(p) {
        const latest=Number(this.store.db.prepare('SELECT MAX(time) AS last FROM candles_1m WHERE pool=?').get(p.address)?.last??0);
        const state=this.store.minuteChart(p.address),close=Math.floor((now-30_000)/60_000)*60_000;
        if((latest+60)*1000<close)add(p,'minute','support','One-minute chart requested while viewed',0,(state.lastAttempt??0)+60_000);
      }
    }
    for(const job of old.values())if(!wanted.has(job.id)&&job.state==='queued')this.store.saveCandleJob({...job,state:'obsolete'});
    if(fulfilled.size)this.store.set('refreshQueue',this.store.get<string[]>('refreshQueue',[]).filter(a=>!fulfilled.has(a)));
    return this.store.candleJobs();
  }
  due(now=Date.now()) { return this.plan(now).filter(j=>j.state==='queued'&&j.dueAt<=now&&j.nextAt<=now); }
  choose(now=Date.now()):{job:CandleJob;turn:number}|null {
    const due=this.due(now),start=this.store.get('candleWeightedTurn',0),rotation=this.policy.rotation;
    for(let offset=0;offset<rotation.length;offset++) {
      const turn=start+offset,queue=rotation[turn%rotation.length];
      const options=due.filter(j=>j.class===queue).sort((a,b)=>{
        if(this.profile==='discovery'&&queue==='early')
          return (a.refreshBy??a.dueAt)-(b.refreshBy??b.dueAt)||a.enqueuedAt-b.enqueuedAt||a.id.localeCompare(b.id);
        // Waiting dominates eventually; a high score cannot indefinitely starve a quieter chart.
        const rank=(j:CandleJob)=>j.score+Math.max(0,now-Math.max(j.dueAt,j.nextAt))/60_000;
        return rank(b)-rank(a)||a.enqueuedAt-b.enqueuedAt||a.id.localeCompare(b.id);
      });
      if(options[0])return {job:options[0],turn};
    }
    return null;
  }
  async run(request:Request,now=Date.now()) {
    if(this.busy||this.mode!=='priority')return;
    const selected=this.choose(now);if(!selected)return;
    const {job,turn}=selected,pool=this.store.pool(job.pool);if(!pool)return;
    this.busy=true;
    let runId:number|null=null,dispatched=false;
    const minutes=job.kind==='minute'?1:5;
    const prior=this.store.candles(pool.address,minutes),previous=new Map(prior.map(c=>[c.time,JSON.stringify(c)]));
    const profile=this.store.snapshotScreen(pool.address);
    const record:any={version:this.policy.version,profile:this.profile,mode:'priority',mint:pool.mint,symbol:pool.symbol,kind:job.kind,class:job.class,refreshBy:job.refreshBy,
      reason:job.reason,dueAt:job.dueAt,enqueuedAt:job.enqueuedAt,waitMs:Math.max(0,now-job.dueAt),outcome:'in-flight',newBars:0,revisedBars:0,
      sampled:job.class==='revisit'&&!profile?.promising,snapshotScreen:profile};
    const start=()=>{
      if(dispatched)return;dispatched=true;
      this.store.transaction(()=>{
        this.store.set('candleWeightedTurn',turn+1);
        this.store.saveCandleJob({...job,state:'running',lastAttempt:Date.now(),nextAt:Date.now()+60_000});
        runId=Number(this.store.db.prepare('INSERT INTO candle_runs(time,pool,data) VALUES(?,?,?)').run(Date.now(),pool.address,JSON.stringify(record)).lastInsertRowid);
      });
    };
    try {
      const params=new URLSearchParams({aggregate:String(minutes),limit:'1000',currency:'usd',token:pool.mint,include_empty_intervals:'false'});
      if(job.before!==undefined)params.set('before_timestamp',String(job.before));
      // Complete cached history stays local. Fetch only a bounded overlap on regular refreshes.
      if(job.kind!=='history'&&prior.length) {
        const missing=Math.ceil(Math.max(0,now/1000-prior.at(-1)!.time)/(minutes*60));
        params.set('limit',String(Math.min(1000,Math.max(12,missing+6))));
      }
      const data=await request(`${GECKO}/networks/solana/pools/${pool.address}/ohlcv/minute?${params}`,{
        jobId:job.id,purpose:job.reason,queueClass:job.class,pool:pool.address,mint:pool.mint,minutes,mode:'priority',
      },start);
      const at=Date.now();
      const bars=closedCandles(geckoCandles(data,pool.mint,minutes),at).filter(c=>job.before===undefined||c.time<=job.before);
      record.returnedBars=bars.length;record.newBars=bars.filter(c=>!previous.has(c.time)).length;
      record.revisedBars=bars.filter(c=>previous.has(c.time)&&previous.get(c.time)!==JSON.stringify(c)).length;
      record.latestClose=bars.length?(bars.at(-1)!.time+minutes*60)*1000:null;
      const expected=Math.floor((at-30_000)/(minutes*60_000))*(minutes*60_000);
      const stale=job.kind!=='history'&&(record.latestClose===null||record.latestClose<expected);
      record.outcome=bars.length?(stale?'stale':'updated'):'empty';
      if(bars.length)this.store.saveCandles(pool.address,bars,`GeckoTerminal · USD · ${minutes}m${job.kind==='history'?' · historical page':''}`,at,minutes);
      if(job.kind==='minute')this.store.set(`minuteChart:${pool.address}`,{checkedAt:stale?this.store.minuteChart(pool.address).checkedAt:at,lastAttempt:at,issue:stale?'Awaiting a newer completed candle':null});
      else {
        const history=this.store.candles(pool.address),p=this.store.pool(pool.address)!;
        this.store.savePool({...p,candleAttempt:job.kind==='history'?p.candleAttempt:at,candleAt:!stale&&bars.length?at:p.candleAt,
          screen:bars.length?'Chart history assessed; formation checks retained':p.screen,
          coverage:history.length?`Candles from ${new Date(history[0].time*1000).toISOString()}; no-trade intervals omitted, indexing completeness unverified`:p.coverage,
          issue:stale?'Awaiting a newer completed candle; retry scheduled':null});
        if(bars.length)this.store.recordSignals(this.store.pool(pool.address)!,detectEpisodes(history,at,this.store.settings()),at);
        record.qualified=this.store.base(pool.address)?.status==='qualified';
      }
      if(job.kind==='history') {
        const cursor=this.store.get<HistoryCursor>(`candleHistory:${pool.address}`,{nextAt:0,done:false,pages:0,issue:null});
        this.store.set(`candleHistory:${pool.address}`,{nextAt:at+hour,done:bars.length===0,pages:cursor.pages+1,issue:bars.length?null:'No earlier indexed candles; completeness unverified'});
      }
      const failures=stale?job.failures+1:0;
      this.store.saveCandleJob({...job,state:stale?'queued':'done',lastAttempt:at,failures,
        nextAt:stale?at+Math.min(1_800_000,60_000*2**Math.min(failures,5)):job.kind==='history'?at+hour:at+minutes*60_000});
      if(job.kind==='latest'&&!stale)this.store.set('refreshQueue',this.store.get<string[]>('refreshQueue',[]).filter(a=>a!==pool.address));
    } catch(error) {
      if(error instanceof Deferred) {
        // No HTTP request means no consumed turn or recorded attempt.
        if(!dispatched)return;
      }
      record.outcome=String(error).includes('429')?'rate-limited':'error';
      record.error=error instanceof Error?error.message.slice(0,180):'Candle request failed';
      const at=Date.now(),failures=job.failures+1;
      this.store.saveCandleJob({...job,state:'queued',lastAttempt:at,failures,nextAt:Math.max(at+Math.min(hour,60_000*2**Math.min(failures,6)),this.store.get('providerCooldown:gecko',0))});
      if(job.kind==='minute')this.store.set(`minuteChart:${pool.address}`,{...this.store.minuteChart(pool.address),lastAttempt:at,issue:record.error});
    } finally {
      if(runId!==null)this.store.db.prepare('UPDATE candle_runs SET data=? WHERE id=?').run(JSON.stringify({...record,finishedAt:Date.now()}),runId);
      this.busy=false;this.plannedAt=0;
    }
  }
  report(now=Date.now()):CandleReport {
    const profileChangedAt=this.store.get<number|null>('candleProfileChangedAt',null);
    const since=Math.max(now-hour,this.store.get('candleTrialStartedAt',now-hour),profileChangedAt??0);
    const rows=this.store.db.prepare('SELECT time,pool,data FROM candle_runs WHERE time>=? ORDER BY id DESC').all(since)
      .map(r=>({...JSON.parse(String(r.data)),time:Number(r.time),pool:String(r.pool)}))
      .filter(r=>(r.profile??'balanced')===this.profile);
    const provider=this.store.db.prepare(`SELECT
      SUM(CASE WHEN summary='Source request started' THEN 1 ELSE 0 END) AS attempts,
      SUM(CASE WHEN json_extract(data,'$.httpStatus')=429 THEN 1 ELSE 0 END) AS limited
      FROM audit WHERE entity='gecko' AND category='request' AND time>=?`).get(since)!;
    const due=this.mode==='priority'?this.due(now):[],queue=Object.fromEntries(classes.map(k=>[k,due.filter(j=>j.class===k).length])) as Record<CandleClass,number>;
    return {mode:this.mode,profile:this.profile,profileChangedAt,profileBaseline:this.store.get('candleProfileBaseline',null),
      version:this.policy.version,changedAt:this.store.get('candleSchedulerChangedAt',null),asOf:now,since,
      firstWaitMs:Math.max(0,...due.filter(j=>j.class==='first').map(j=>now-Math.max(j.dueAt,j.nextAt))),
      earlyOverdue:this.mode==='priority'?this.store.candleJobs().filter(j=>j.state==='queued'&&j.class==='early'&&j.refreshBy!==undefined&&j.refreshBy<now).length:0,
      earlyRefreshes:rows.filter(r=>r.class==='early'&&r.outcome==='updated').length,
      pace:this.mode==='priority'?this.store.get('candleGeckoPace',8):24,cooldownUntil:this.store.get('providerCooldown:gecko',0),queue,
      oldestWaitMs:Math.max(0,...due.map(j=>now-Math.max(j.dueAt,j.nextAt))),attempts:rows.length,successes:rows.filter(r=>['updated','stale','empty'].includes(r.outcome)).length,
      limited:rows.filter(r=>r.outcome==='rate-limited').length,distinctTokens:new Set(rows.filter(r=>['updated','stale','empty'].includes(r.outcome)).map(r=>r.mint)).size,
      providerAttempts:Number(provider.attempts??0),providerLimited:Number(provider.limited??0),
      firstChecks:rows.filter(r=>r.class==='first'&&r.newBars>0).length,newBars:rows.reduce((n,r)=>n+r.newBars,0),stale:rows.filter(r=>r.outcome==='stale'||r.outcome==='empty').length,
      sampledRevisits:rows.filter(r=>r.sampled&&r.outcome==='updated').length,sampledQualified:rows.filter(r=>r.sampled&&r.outcome==='updated'&&r.qualified).length,
      shares:classes.filter(key=>this.policy.shares[key]>0||queue[key]>0||rows.some(r=>r.class===key))
        .map(key=>({key,label:CANDLE_LABELS[key],target:this.policy.shares[key],attempts:rows.filter(r=>r.class===key).length})),
      recent:rows.slice(0,8).map(r=>({time:r.time,symbol:r.symbol,mint:r.mint,pool:r.pool,reason:r.reason,outcome:r.outcome,newBars:r.newBars})),
      baseline:this.store.get('candleTrialBaseline',null)};
  }
}
