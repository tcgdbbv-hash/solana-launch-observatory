import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/store.ts';
import { blankPool } from '../server/providers.ts';
import { assessDrawdown } from '../shared/drawdown.ts';
import { automaticShortlistStage, shortlistStage } from '../shared/shortlist.ts';
import { shortlisted } from '../shared/research.ts';
import { CandleScheduler } from '../server/candle-scheduler.ts';

function example(path=':memory:') {
  const f=JSON.parse(readFileSync(new URL('./fixtures/martians-before-breakout.json',import.meta.url),'utf8'));
  const now=f.asOf,p={...blankPool(f.pool.address,f.pool.mint,f.pool.venue,now),...f.pool,metricsAt:now,
    price:f.candles.at(-1).close,marketCap:100_000,capBasis:'provider_reported' as const,liquidity:20_000,buys:3,sells:3,volume5m:100};
  const store=new Store(path);store.discover(p);store.saveCandles(p.address,f.candles,'saved example',now);
  store.recordSignals(p,f.episodes.map((e:any)=>e.signal),now);
  return {store,p,now,f};
}
test('manual up/down moves persist, preserve scanner checks and release back to automatic',()=>{
  const folder=mkdtempSync(join(tmpdir(),'manual-tier-')),path=join(folder,'test.sqlite');
  const f=example(path);let store=f.store;
  try {
    const before=store.candidates(f.now)[0],risk=before.risk,settings=store.settings(),alerts=store.unreadAlerts();
    assert.equal(automaticShortlistStage(before,f.now),'forming');
    store.moveStage(f.p.mint,'ready','Repeated higher lows','move-up-001',f.now);
    let row=store.candidates(f.now)[0];
    assert.equal(shortlistStage(row,f.now),'ready');assert.equal(shortlisted(row,f.now),false);
    assert.equal(row.manualWatch,before.manualWatch,'placement alone does not enable following alerts');
    assert.deepEqual(row.risk,risk);assert.equal(store.unreadAlerts(),alerts,'a manual promotion is not an automatic alert');
    store.close();store=new Store(path);
    row=store.candidates(f.now)[0];assert.equal(shortlistStage(row,f.now),'ready');
    store.moveStage(f.p.mint,'early','Still unsettled','move-down-002',f.now+1);
    assert.equal(shortlistStage(store.candidates(f.now+1)[0],f.now+1),'early');
    store.refreshBase(f.p,f.now+2);
    assert.equal(shortlistStage(store.candidates(f.now+2)[0],f.now+2),'early','automatic refresh cannot overwrite human placement');
    store.moveStage(f.p.mint,null,'','move-auto-003',f.now+3);
    assert.equal(shortlistStage(store.candidates(f.now+3)[0],f.now+3),'forming');
    assert.deepEqual(store.settings(),settings);assert.equal(store.stageReviews(f.p.mint).length,3);
  }finally{store.close();rmSync(folder,{recursive:true,force:true});}
});
test('tier feedback freezes as-of evidence, accepts empty notes and deduplicates retries',()=>{
  const {store,p,now,f}=example();
  try {
    store.saveCandles(p.address,[{...f.candles[0],time:now/1000+300,close:999}],'future fixture',now);
    const first=store.moveStage(p.mint,'ready','<script>my observation</script>','same-request-001',now);
    assert.equal(store.moveStage(p.mint,'ready','<script>my observation</script>','same-request-001',now).id,first.id);
    assert.throws(()=>store.moveStage(p.mint,'early','changed','same-request-001',now),/already been used/);
    store.moveStage(p.mint,'early','','next-request-002',now+1);
    const saved=[...store.stageReviewExport(p.mint)][0];
    assert.equal(saved.fromStage,'forming');assert.equal(saved.toStage,'ready');assert.equal(saved.automaticStage,'forming');
    assert.ok(saved.snapshot.candles.every((b:any)=>(b.time+300)*1000<=now));
    const oldClose=saved.snapshot.candles[0].close;
    store.saveCandles(p.address,[{...f.candles[0],close:777}],'later correction',now+2);
    assert.equal([...store.stageReviewExport(p.mint)][0].snapshot.candles[0].close,oldClose);
    assert.equal(store.feedbackSummary().tierReviews?.total,2);
    assert.equal(store.stageReviews(p.mint)[0].reason,'');
    assert.equal(store.activity('tier-review',p.mint).total,2);
  }finally{store.close();}
});
test('manual placement does not bypass archive, liquidity or failed controls',()=>{
  const {store,p,now}=example();
  try {
    store.moveStage(p.mint,'ready','','place-first-001',now);
    const row=store.candidates(now)[0];
    for(const changed of [{...row,archived:true},{...row,researchTags:['not_matching' as const]},
      {...row,risk:{...row.risk,status:'excluded' as const}}, {...row,poolData:{...row.poolData,liquidity:999}},
      {...row,poolData:{...row.poolData,venue:'Meteora' as const}}])assert.equal(shortlistStage(changed,now),null);
    store.patchCandidate(p.mint,{archived:true},now+1);
    assert.throws(()=>store.moveStage(p.mint,'early','','blocked-move-002',now+2),/Restore/);
    store.moveStage(p.mint,null,'Clear saved placement','reset-blocked-003',now+3);
    assert.equal(store.candidate(p.mint)!.archived,true);
    assert.equal(store.candidate(p.mint)!.manualStage,null);
  }finally{store.close();}
});
test('extreme drawdown uses the recorded closing peak, ignores future prices and blocks automatic tiers',()=>{
  const {store,p,now,f}=example();
  try {
    const huge={...f.candles[0],close:p.price*25,high:p.price*100,volume:100};
    store.saveCandles(p.address,[huge],'earlier peak',now);
    const drawdown=store.drawdown(p,now)!;assert.ok(drawdown.percent>=95);assert.equal(drawdown.peakPrice,huge.close);
    const row=store.candidates(now)[0];row.group='new';row.risk={...row.risk,status:'passed'};
    assert.equal(shortlisted(row,now),false);assert.equal(automaticShortlistStage(row,now),null);
    store.moveStage(p.mint,'early','Reconsider after recovery','hold-review-001',now);
    assert.equal(shortlistStage(store.candidates(now)[0],now),'early');
    assert.equal(automaticShortlistStage(store.candidates(now)[0],now),null);
    assert.equal(assessDrawdown({...p,metricsAt:now+1},{price:huge.close,at:now-1000,source:'fixture'},now),null);
    store.saveCandles(p.address,[{...huge,time:now/1000+300,close:999999}],'future price',now);
    assert.equal(store.drawdown(p,now)!.peakPrice,huge.close);
    const recovery={...p,price:huge.close*.11,metricsAt:now+1};
    assert.equal(store.drawdown(recovery,now+1)!.held,false,'recovery can remove the hold without deleting peak history');
  }finally{store.close();}
});
test('a small rebound after a recorded 95% collapse stays held; a larger recovery clears it',()=>{
  const now=1_790_000_000_000,p={...blankPool('P','M','PumpSwap',now),price:.049,metricsAt:now};
  const peak={price:1,at:now-10_000,source:'closed price',troughPrice:.049,troughAt:now-1000};
  assert.equal(assessDrawdown(p,peak,now)!.held,true);
  const bounce=assessDrawdown({...p,price:.051},peak,now)!;
  assert.ok(bounce.percent<95);assert.equal(bounce.held,true);
  assert.equal(assessDrawdown({...p,price:.101},peak,now)!.held,false);
  assert.equal(assessDrawdown({...p,price:.051},{...peak,troughAt:now+1000},now)!.held,false,'future lows cannot create an earlier hold');
});
test('a new small pump cannot erase an earlier collapse; held charts retain background reassessment',()=>{
  const {store,p,now,f}=example();
  try {
    const peak={...f.candles[0],close:p.price*25,high:p.price*25};store.saveCandles(p.address,[peak],'recorded earlier peak',now);
    const little={...f.episodes[0].signal,peak:p.price*2,trigger:f.episodes[0].signal.trigger+300};
    store.recordSignals(p,[little],now+1);
    assert.equal(store.drawdown(p,now+1)!.peakPrice,peak.close);
    store.set('snapshotScreen:'+p.address,{promising:true,at:now+1,score:100,hours:1,reasons:['fixture']});
    const scheduler=new CandleScheduler(store,()=>2);
    const job=scheduler.plan(now+600_000).find(j=>j.pool===p.address&&j.kind==='latest');
    assert.equal(job?.class,'revisit');assert.match(job!.reason,/Extreme retracement/);
    store.updateMetrics({...p,metricsAt:now+2},now+2);
    const events=store.activity('drawdown',p.mint).events;assert.ok(events.some(e=>(e.data as any).current.held));
  }finally{store.close();}
});
