import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/store.ts';
import { Collector, Deferred } from '../server/collector.ts';
import { CandleScheduler } from '../server/candle-scheduler.ts';
import { screenSnapshots } from '../server/snapshot-screen.ts';
import { blankPool } from '../server/providers.ts';
import type { SnapshotPoint, CandleClass, CandleJob } from '../shared/candle-policy.ts';
import { shortlistStage } from '../shared/shortlist.ts';

const now=1_790_553_660_000, hour=3_600_000;
function point(time:number,price:number):SnapshotPoint {
  return {time,price,liquidity:5000,volume5m:.5,buys:2,sells:1,source:'DEX Screener'};
}
function pool(store:Store,address:string,hasCandles=true,mint=address+'-mint') {
  const p={...blankPool(address,mint,'PumpSwap',now-4*hour),createdAt:now-4*hour,liquidity:5000,price:1,metricsAt:now,candleAttempt:null};
  store.discover(p);
  if(hasCandles)store.saveCandles(p.address,[{time:now/1000-hour/1000,open:1,high:1,low:1,close:1,volume:1}],'fixture',now);
  return p;
}
test('snapshot hints recognise low-volume rising ranges but cannot confirm formations or reward dead/gappy data',()=>{
  const points=Array.from({length:25},(_,i)=>point(now-(24-i)*300_000,Math.exp(i*.002+Math.sin(i*1.5)*.005)));
  assert.equal(screenSnapshots(points,now).promising,true,'gentle slope is measured around its trend');
  assert.equal(screenSnapshots(points.map(p=>({...p,buys:0,sells:0})),now).promising,false);
  assert.equal(screenSnapshots(points.filter((_,i)=>i%3===0),now).promising,false);
  assert.equal(screenSnapshots(points,now+hour).promising,false,'old provider observations are not current evidence');
  assert.equal(screenSnapshots(points.map((p,i)=>({...p,price:Math.exp(-i*.03)})),now).promising,false);
  assert.equal(screenSnapshots(points.map((p,i)=>({...p,price:i===24?p.price!*2:p.price})),now).promising,false);
});
test('successful unchanged polls preserve five-minute observation coverage without duplicating changed-value snapshots',()=>{
  const store=new Store(':memory:');try {
    store.set('candleSchedulerMode','priority');const p=pool(store,'observed');
    for(let i=0;i<12;i++)store.updateMetrics({...p,metricsAt:now+i*300_000,buys:1,sells:1},now+i*300_000);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM snapshot_checks').get()!.n,12);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM snapshots').get()!.n,1);
    store.updateMetrics({...p,metricsAt:now+11*300_000+1000,buys:1,sells:1},now+11*300_000+1000);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM snapshot_checks').get()!.n,12);
    assert.equal(store.snapshotScreen(p.address)?.promising,true);
  }finally{store.close();}
});
test('weighted turns preserve 50/20/20/10 under sustained demand; deferred requests spend nothing',async t=>{
  t.mock.method(Date,'now',()=>now);
  const store=new Store(':memory:');t.after(()=>store.close());const scheduler=new CandleScheduler(store,()=>0);scheduler.setMode('priority',now);
  const jobs:CandleJob[]=[];
  for(const cls of ['promising','first','revisit','support'] as CandleClass[])for(let i=0;i<12;i++) {
    const p=pool(store,cls+i,false);
    jobs.push({id:p.address+':latest',pool:p.address,mint:p.mint,kind:'latest',class:cls,reason:cls,score:0,dueAt:now-hour,enqueuedAt:now-hour,
      state:'queued',lastAttempt:null,failures:0,nextAt:0});
  }
  jobs.forEach(j=>store.saveCandleJob(j));t.mock.method(scheduler,'plan',()=>store.candleJobs());
  await scheduler.run(async()=>{throw new Deferred('budget');});
  assert.equal(store.get('candleWeightedTurn',0),0);assert.equal(scheduler.report(now).attempts,0);
  for(let i=0;i<10;i++)await scheduler.run(async(_url,context,start)=>{
    start();return {meta:{base:{address:context.mint}},data:{attributes:{ohlcv_list:[[Math.floor(now/300_000)*300-300,1,1,1,1,.5]]}}};
  });
  assert.deepEqual(scheduler.report(now).shares.map(x=>[x.key,x.attempts]),[['promising',5],['first',2],['revisit',2],['support',1]]);
  assert.equal(new Set(scheduler.report(now).recent.map(r=>r.pool)).size,8);
});
test('one selected pool, fresh cache and archived exclusions prevent duplicate or pointless work',t=>{
  t.mock.method(Date,'now',()=>now);const store=new Store(':memory:');t.after(()=>store.close());
  const a=pool(store,'largest',true,'same'),b=pool(store,'secondary',true,'same');store.savePool({...a,liquidity:10000});
  const scheduler=new CandleScheduler(store,()=>0);scheduler.setMode('priority',now);
  assert.deepEqual(scheduler.plan(now).filter(j=>j.state==='queued').map(j=>j.pool),[a.address]);
  store.set('refreshQueue',[a.address,a.address]);
  store.saveCandles(a.address,[{time:Math.floor((now-30_000)/300_000)*300-300,open:1,high:1,low:1,close:1,volume:1}],'fixture',now);
  assert.equal(scheduler.plan(now,true).filter(j=>j.state==='queued'&&j.kind==='latest').length,0);
  assert.deepEqual(store.get('refreshQueue',[]),[]);
  store.saveCandidate({mint:a.mint,pool:a.address,qualifiedAt:now,reviewed:false,pinned:true,archived:true,below:null,lastCapAt:null,label:'',updatedAt:now});
  store.set('refreshQueue',[b.address]);store.set('minuteChartWatch',{address:b.address,until:now+60_000});
  assert.equal(scheduler.plan(now,true).filter(j=>j.state==='queued').length,0);
});
test('failed requests consume their turn, back off and persist across restart; rollback keeps all evidence',async t=>{
  t.mock.method(Date,'now',()=>now);const dir=mkdtempSync(join(tmpdir(),'candle-policy-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  let store=new Store(join(dir,'test.sqlite'));const p=pool(store,'retry',false);
  let scheduler=new CandleScheduler(store,()=>0);scheduler.setMode('priority',now);
  await scheduler.run(async(_url,_context,start)=>{start();throw new Error('Provider returned HTTP 429');});
  const turn=store.get('candleWeightedTurn',0);assert.ok(turn>0);assert.equal(scheduler.report(now).limited,1);
  assert.equal(scheduler.due(now).length,0);store.close();
  store=new Store(join(dir,'test.sqlite'));scheduler=new CandleScheduler(store,()=>0);
  assert.equal(store.get('candleWeightedTurn',0),turn);assert.equal(scheduler.due(now).length,0);
  const before=JSON.stringify(store.pool(p.address));scheduler.setMode('legacy',now+1000);
  assert.equal(scheduler.mode,'legacy');assert.equal(JSON.stringify(store.pool(p.address)),before);
  let fetched=false;await scheduler.run(async()=>{fetched=true;});assert.equal(fetched,false);
  scheduler.setMode('priority',now+2000);assert.equal(scheduler.report(now).limited,1);assert.equal(scheduler.due(now).length,0);store.close();
});
test('quiet or unobserved histories retain a revisit route without a fresh pump; history requests need an evidence gap',t=>{
  t.mock.method(Date,'now',()=>now);const store=new Store(':memory:');t.after(()=>store.close());
  const old=pool(store,'quiet'),fresh=pool(store,'unseen',false);const scheduler=new CandleScheduler(store,()=>0);scheduler.setMode('priority',now);
  const due=scheduler.due(now);
  assert.equal(due.find(j=>j.pool===old.address)?.class,'revisit');assert.equal(due.find(j=>j.pool===fresh.address)?.class,'first');
  assert.equal(due.some(j=>j.kind==='history'),false,'do not backfill every pool on a separate timer');
});
test('new provider pacing backs off after 429 and counts actual dispatch only',async t=>{
  t.mock.method(Date,'now',()=>now);const store=new Store(':memory:');t.after(()=>store.close());
  const collector=new Collector(store);collector.candleScheduler.setMode('priority',now);collector.candleScheduler.setProfile('discovery',now);let calls=0;
  t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response('{}',{status:429,headers:{'Retry-After':'120'}});});
  await assert.rejects(collector.request('gecko','https://api.geckoterminal.com/api/v2/test'),/429/);
  assert.equal(store.get('candleGeckoPace',8),6);assert.ok(store.get('providerCooldown:gecko',0)>=now+120_000);
  await assert.rejects(collector.request('gecko','https://api.geckoterminal.com/api/v2/test'),Deferred);
  assert.equal(calls,1);assert.equal(store.countRequests('gecko',now-60_000),1);
});

test('discovery balance reserves 35/25/20/15/5, borrows empty lanes and preserves deferred turns',async t=>{
  t.mock.method(Date,'now',()=>now);
  const store=new Store(':memory:');t.after(()=>store.close());const scheduler=new CandleScheduler(store,()=>0);
  scheduler.setMode('priority',now);scheduler.setProfile('discovery',now);
  for(const cls of ['promising','first','early','revisit','support'] as CandleClass[])for(let i=0;i<8;i++) {
    const p=pool(store,cls+i,false);
    store.saveCandleJob({id:p.address+':latest',pool:p.address,mint:p.mint,kind:'latest',class:cls,reason:cls,
      score:cls==='promising'?1000:0,dueAt:now-hour,enqueuedAt:now-hour,state:'queued',lastAttempt:null,failures:0,nextAt:0});
  }
  t.mock.method(scheduler,'plan',()=>store.candleJobs());
  await scheduler.run(async()=>{throw new Deferred('provider budget');});
  assert.equal(store.get('candleWeightedTurn',0),0);
  const answer=async(_url:string,context:{mint:string},start:()=>void)=>{
    start();return {meta:{base:{address:context.mint}},data:{attributes:{ohlcv_list:[[Math.floor(now/300_000)*300-300,1,1,1,1,.5]]}}};
  };
  for(let i=0;i<20;i++)await scheduler.run(answer);
  const r=scheduler.report(now);
  assert.deepEqual(r.shares.map(x=>[x.key,x.attempts]),[['promising',4],['first',7],['early',5],['revisit',3],['support',1]]);
  assert.equal(r.firstChecks,7);assert.equal(r.earlyRefreshes,5);
  for(const j of store.candleJobs())if(j.class!=='first')store.saveCandleJob({...j,state:'obsolete'});
  await scheduler.run(answer);
  assert.equal(scheduler.report(now).firstChecks,8,'remaining lane borrows idle capacity');
});

test('Early signs refresh at ten minutes and recover expired evidence without changing admission or data',t=>{
  const f=JSON.parse(readFileSync(new URL('./fixtures/martians-before-breakout.json',import.meta.url),'utf8'));
  const at=f.asOf;t.mock.method(Date,'now',()=>at);
  const store=new Store(':memory:');t.after(()=>store.close());
  const p={...blankPool(f.pool.address,f.pool.mint,f.pool.venue,at),...f.pool,
    metricsAt:at,price:f.candles.at(-1).close,marketCap:100_000,capBasis:'provider_reported' as const,
    liquidity:20_000,volume5m:100,buys:3,sells:3,candleAttempt:at-11*60_000};
  store.discover(p);store.saveCandles(p.address,f.candles.filter((b:{time:number})=>b.time<=at/1000-900),'saved example',at);
  store.recordSignals(p,f.episodes.map((e:any)=>({...e.signal,stage:'Pump + pullback',pullback:.5})),at);
  store.set(`base:${p.address}`,{...store.base(p.address),status:'insufficient',candleEnd:at-10*60_000});
  const scheduler=new CandleScheduler(store,()=>0);scheduler.setMode('priority',at);
  const before=()=>JSON.stringify(['candidates','episodes','candles','notes','feedback','stage_reviews'].map(name=>store.db.prepare(`SELECT * FROM ${name}`).all()));
  const saved=before();
  assert.equal(shortlistStage(store.candidates(at)[0],at),'early','pending checks do not delay Early signs');
  const old=scheduler.plan(at,true).find(j=>j.kind==='latest')!;
  assert.equal(old.class,'revisit');assert.equal(old.dueAt,p.candleAttempt+30*60_000);
  scheduler.setProfile('discovery',at);
  let job=scheduler.plan(at,true).find(j=>j.kind==='latest')!;
  assert.equal(job.class,'early');assert.equal(job.dueAt,p.candleAttempt+10*60_000);
  assert.equal(job.refreshBy,at+20*60_000);
  // Expiry removes UI admission but cannot strand this prior observation.
  store.set(`base:${p.address}`,{...store.base(p.address),candleEnd:at-40*60_000});
  assert.equal(shortlistStage(store.candidates(at)[0],at),null);
  job=scheduler.plan(at,true).find(j=>j.kind==='latest')!;
  assert.equal(job.class,'early');assert.match(job.reason,/expired/);
  assert.equal(scheduler.report(at).earlyOverdue,1);
  store.saveCandleJob({...job,nextAt:at+hour,failures:3});
  scheduler.plan(at,true);
  assert.equal(scheduler.due(at).some(j=>j.id===job.id),false,'recovery never overrides provider/job backoff');
  assert.equal(scheduler.report(at).earlyOverdue,1,'waiting for backoff does not hide stale evidence');
  scheduler.setProfile('balanced',at+1);
  job=scheduler.plan(at+1,true).find(j=>j.kind==='latest')!;
  assert.equal(job.class,'revisit');assert.equal(job.dueAt,old.dueAt);assert.equal(job.refreshBy,undefined);
  assert.equal(job.nextAt,at+hour);assert.equal(job.failures,3);
  assert.equal(before(),saved,'scheduling changes preserve user records and chart evidence');
  assert.equal(shortlistStage(store.candidates(at)[0],at),null);
});

test('discovery slows snapshot-only refreshes; first looks and Early signs order by wait and freshness',t=>{
  t.mock.method(Date,'now',()=>now);const store=new Store(':memory:');t.after(()=>store.close());
  const p=pool(store,'hint');store.savePool({...p,candleAttempt:now-6*60_000});
  t.mock.method(store,'snapshotScreen',()=>({at:now,score:50,promising:true,coverage:100,hours:2,width:5,slope:1,contraction:1,reasons:['Quiet range']}));
  const scheduler=new CandleScheduler(store,()=>0);scheduler.setMode('priority',now);
  assert.equal(scheduler.due(now).find(j=>j.pool===p.address)?.class,'promising');
  scheduler.setProfile('discovery',now);
  assert.equal(scheduler.due(now).some(j=>j.pool===p.address&&j.kind==='latest'),false);
  assert.equal(scheduler.plan(now).find(j=>j.pool===p.address)!.dueAt,now+14*60_000);
  scheduler.setProfile('balanced',now+1);
  assert.equal(scheduler.due(now+1).find(j=>j.pool===p.address)?.class,'promising');
  scheduler.setProfile('discovery',now+2);
  const job=(id:string,cls:CandleClass,dueAt:number,refreshBy?:number):CandleJob=>({id,pool:id,mint:id,kind:'latest',class:cls,
    reason:'fixture',score:0,dueAt,enqueuedAt:dueAt,state:'queued',lastAttempt:null,failures:0,nextAt:0,refreshBy});
  const jobs=[job('new-first','first',now-1000),job('old-first','first',now-hour),
    job('early-fresh','early',now-hour,now+10*60_000),job('early-expired','early',now-1000,now-10*60_000)];
  t.mock.method(scheduler,'plan',()=>jobs);
  assert.equal(scheduler.choose(now)?.job.id,'old-first');
  store.set('candleWeightedTurn',1);assert.equal(scheduler.choose(now)?.job.id,'early-expired');
});

test('profile result windows and baseline survive restart without mixing previous-balance results',t=>{
  t.mock.method(Date,'now',()=>now);const dir=mkdtempSync(join(tmpdir(),'candle-balance-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  let store=new Store(join(dir,'test.sqlite')),scheduler=new CandleScheduler(store,()=>0);scheduler.setMode('priority',now-hour);
  store.db.prepare('INSERT INTO candle_runs(time,pool,data) VALUES(?,?,?)').run(now-1000,'old',JSON.stringify({class:'first',outcome:'updated',newBars:12,mint:'old',symbol:'old'}));
  scheduler.setProfile('discovery',now);
  assert.equal(scheduler.report(now).attempts,0);assert.equal(scheduler.report(now).profileBaseline?.firstChecks,1);
  // A request already dispatched under the old balance may finish after switching.
  store.db.prepare('INSERT INTO candle_runs(time,pool,data) VALUES(?,?,?)').run(now,'in-flight-old',JSON.stringify({profile:'balanced',class:'first',outcome:'updated',newBars:12,mint:'old'}));
  assert.equal(scheduler.report(now).attempts,0);
  store.close();store=new Store(join(dir,'test.sqlite'));t.after(()=>store.close());scheduler=new CandleScheduler(store,()=>0);
  assert.equal(scheduler.profile,'discovery');assert.equal(scheduler.report(now).profileBaseline?.firstChecks,1);
  assert.equal(scheduler.report(now).since,now);assert.equal(scheduler.report(now).attempts,0);
});
