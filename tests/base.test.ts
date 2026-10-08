import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assessBase } from '../server/base-detector.ts';
import { detectEpisodes } from '../server/detector.ts';
import { blankPool } from '../server/providers.ts';
import { Store } from '../server/store.ts';
import { currentBase, priceWithinBase } from '../shared/base.ts';
import { shortlisted, inResearchWatchlist } from '../shared/research.ts';
import { TOKEN, USDC, RISK_POLICY, assessMint, assessTrading, parseQuote } from '../server/security.ts';
import { approveScopeChecks } from './scope-fixtures.ts';
import type { Candle, Episode, Pool } from '../shared/types.ts';

const start=1_790_000_100;
test('the saved MARTIANS pre-breakout example qualifies using only its earlier candles',()=>{
  const f=JSON.parse(readFileSync(new URL('./fixtures/martians-before-breakout.json',import.meta.url),'utf8'));
  const p={...blankPool(f.pool.address,f.pool.mint,f.pool.venue,f.asOf),...f.pool};
  const base=assessBase(p,f.candles,f.episodes,f.asOf);
  assert.ok(f.candles.every((c:Candle)=>(c.time+330)*1000<=f.asOf));
  assert.equal(base.status,'qualified',base.reasons.join('; '));
  assert.equal(base.durationHours,2);assert.ok(base.floorTests>=3);assert.ok(base.ceilingTests>=2);
  const last=f.candles.at(-1),future={...last,time:last.time+300,close:last.close*4,high:last.close*4};
  assert.deepEqual(assessBase(p,[...f.candles,future],f.episodes,f.asOf),base,'a later pump cannot be used to qualify this example');
});
function fixture(hours=1) {
  const closes=[1,1,1,1,1.4,2.2,3,4,3.2,2.4,...Array.from({length:hours*12},(_,i)=>[2,2.04,2.1,2.04][i%4])];
  const bars:Candle[]=closes.map((close,i)=>({time:start+i*300,open:closes[Math.max(0,i-1)],close,
    high:Math.max(close,closes[Math.max(0,i-1)])*1.01,low:Math.min(close,closes[Math.max(0,i-1)])*.99,
    volume:i<3?.02:i<10?.2:.01}));
  const now=(bars.at(-1)!.time+331)*1000;
  const p:Pool={...blankPool('base-pool','base-mint','PumpSwap',now),createdAt:start*1000,
    marketCap:60_000,capBasis:'provider_reported',price:2,liquidity:20_000,metricsAt:now};
  const episodes:Episode[]=detectEpisodes(bars,now).map((signal,i)=>({id:i+1,pool:p.address,mint:p.mint,detectedAt:now,signal,original:structuredClone(signal)}));
  return {p,bars,now,episodes};
}
function passChecks(store:Store,p:Pool,now:number) {
  store.saveSecurity(assessMint(p.mint,{owner:TOKEN,executable:false,space:82,data:{parsed:{type:'mint',info:{isInitialized:true,supply:'1000000000000000',decimals:6,mintAuthority:null,freezeAuthority:null}}}},
    {address:TOKEN,immutable:true,programData:'fixture',checkedAt:now,reason:'fixture'},now,1));
  const quote=(inputMint:string,outputMint:string,inAmount:string,outAmount:string)=>parseQuote({inputMint,outputMint,inAmount,outAmount,swapMode:'ExactIn',priceImpact:.1,routePlan:[{swapInfo:{ammKey:p.address}}]},inputMint,outputMint,inAmount,now);
  const buy=quote(USDC,p.mint,RISK_POLICY.sampleUsdcRaw,'1000000'),sell=quote(p.mint,USDC,buy.outAmount,'24900000');
  store.saveTrading(assessTrading(p,buy,sell,now));approveScopeChecks(store,p,now);
}
test('hours-long active base qualifies after a pump and selloff, without a universal dollar-volume minimum',()=>{
  const {p,bars,episodes,now}=fixture();const base=assessBase(p,bars,episodes,now);
  assert.equal(base.status,'qualified',base.reasons.join('; '));assert.equal(base.durationHours,1);
  assert.ok(base.floorTests>=3);assert.ok(base.ceilingTests>=2);assert.ok(currentBase(base,now));
  assert.equal(currentBase(base,now+3_600_000),false);
  const longer=fixture(24), mature=assessBase(longer.p,longer.bars,longer.episodes,longer.now);
  assert.equal(mature.status,'qualified');assert.equal(mature.durationHours,24);assert.ok(mature.score>base.score);
});
test('a pump alone, a dead chart, a falling range, and sparse candles cannot qualify',()=>{
  const {p,bars,episodes,now}=fixture();
  assert.notEqual(assessBase(p,bars.slice(0,10),episodes,now).status,'qualified');
  const dead=bars.map((c,i)=>i<10?c:{...c,volume:0});assert.equal(assessBase(p,dead,episodes,now).status,'inactive');
  const falling=bars.map((c,i)=>i<10?c:{...c,open:2-(i-10)*.07,close:2-(i-10)*.07,high:2.02-(i-10)*.07,low:1.98-(i-10)*.07});
  assert.notEqual(assessBase(p,falling,episodes,now).status,'qualified');
  assert.notEqual(assessBase(p,bars.filter((_,i)=>i<10||i%3!==0),episodes,now).status,'qualified');
});
function slopeFixture(hourly=.02, compress=false) {
  const f=fixture(24);
  f.bars=f.bars.map((c,i)=>{
    if(i<10)return c;
    const j=i-10, amplitude=compress?(j<144?.04:.015):.025;
    const close=1.4*Math.exp(hourly*j/12)*(1+[0,.5,1,.5][j%4]*amplitude);
    return {...c,open:close,high:close*1.002,low:close*.998,close};
  });
  return f;
}
test('a gently rising channel qualifies despite large absolute drift, ranks higher, and reports compression separately',()=>{
  const f=slopeFixture(), rising=assessBase(f.p,f.bars,f.episodes,f.now);
  const flat=slopeFixture(0), sideways=assessBase(flat.p,flat.bars,flat.episodes,flat.now);
  assert.equal(rising.status,'qualified',rising.reasons.join('; '));assert.equal(rising.shape,'rising');
  assert.equal(rising.durationHours,24);assert.ok(rising.driftPercent!>12);
  assert.ok(rising.rawWidthPercent!>30);assert.ok(rising.widthPercent!<5);
  assert.ok(rising.floorStart!<rising.floor!);assert.ok(rising.ceilingStart!<rising.ceiling!);
  assert.equal(rising.priorityBoost,10);assert.ok(rising.score>sideways.score);
  const t=slopeFixture(.02,true), tightening=assessBase(t.p,t.bars,t.episodes,t.now);
  assert.equal(tightening.status,'qualified',tightening.reasons.join('; '));assert.equal(tightening.compression,'tightening');
  assert.equal(tightening.priorityBoost,15);assert.equal(tightening.tightnessTier,5);
  const early=(f.bars[100].time+331)*1000;
  assert.deepEqual(assessBase(f.p,f.bars,f.episodes,early),assessBase(f.p,f.bars.slice(0,101),f.episodes,early));
});
test('detrending does not turn a ramp, a step, a falling channel or an inactive slope into a base',()=>{
  const f=slopeFixture();
  for(const kind of ['ramp','step','falling','inactive'] as const) {
    const bars=f.bars.map((c,i)=>{
      if(i<10)return c;
      const j=i-10, close=kind==='ramp'?1.4*Math.exp(.02*j/12)
        :kind==='step'?(j<144?1.4:2.1):kind==='falling'?1.4*Math.exp(-.03*j/12)*(1+[0,.5,1,.5][j%4]*.025):c.close;
      return {...c,open:close,high:close*1.002,low:close*.998,close,volume:kind==='inactive'?0:c.volume};
    });
    assert.notEqual(assessBase(f.p,bars,f.episodes,f.now).status,'qualified',kind);
  }
});
test('a base needs supported earlier price evidence and never uses future bars or unknown launch timing',()=>{
  const {p,bars,episodes,now}=fixture();
  assert.equal(assessBase(p,bars,[],now).status,'insufficient');
  assert.equal(assessBase({...p,createdAt:null},bars,episodes,now).status,'insufficient');
  const unsupported=episodes.map(e=>({...e,signal:{...e.signal,volumeQualified:false}}));
  assert.equal(assessBase(p,bars,unsupported,now).status,'insufficient');
  const early=(bars[9].time+331)*1000;
  assert.deepEqual(assessBase(p,bars,episodes,early),assessBase(p,bars.slice(0,10),episodes,early));
});
test('only a fresh base with passed checks is shortlisted; rechecks deduplicate and a broken base notifies once',()=>{
  const {p,bars,episodes,now}=fixture(),store=new Store(':memory:');
  try {
    store.discover(p);store.saveCandles(p.address,bars,'isolated fixture',now);store.recordSignals(p,episodes.map(e=>e.signal),now);
    store.observeGroups(now);assert.equal(shortlisted(store.candidates(now)[0],now),false);assert.equal(store.unreadAlerts(),0);
    passChecks(store,p,now);
    assert.equal(store.unreadAlerts(),1,'the final check must admit immediately without a periodic sweep');
    assert.equal(store.candidates(now)[0].shortlistedAt,now);
    store.observeGroups(now+1);
    assert.equal(shortlisted(store.candidates(now+1)[0],now+1),true);assert.equal(store.unreadAlerts(),1);
    assert.equal(store.alerts().alerts[0].kind,'base_qualified');
    store.observeGroups(now+2);assert.equal(store.unreadAlerts(),1);
    assert.ok(store.candidates(now+2)[0].shortlistedAt);
    const corrected=bars.map((c,i)=>i<10?c:{...c,volume:0});
    store.saveCandles(p.address,corrected,'fixture revision',now+3);store.refreshBase(p,now+3);
    assert.equal(store.base(p.address)?.status,'inactive','same-end candle correction must be re-evaluated');
    assert.equal(store.unreadAlerts(),2,'changed base evidence notifies immediately');
    store.observeGroups(now+4);store.observeGroups(now+5);
    assert.equal(store.unreadAlerts(),2);assert.equal(store.alerts().alerts[0].kind,'base_lost');
    store.markAlertsRead(store.alerts().alerts[0].id,now+6);
    store.saveCandles(p.address,bars,'recovered range',now+7);store.refreshBase(p,now+7);
    assert.equal(shortlisted(store.candidates(now+7)[0],now+7),true);
    assert.equal(store.alerts().alerts.length,2,'quiet requalification keeps the existing daily notification cooldown');
    // Simulate an admission saved by the older version: its existing loss
    // alert must still prevent another notification after a restart/upgrade.
    const admission=store.get<any>(`baseAdmission:${p.address}`,null);delete admission.lostNotifiedAt;
    store.set(`baseAdmission:${p.address}`,admission);
    store.saveCandles(p.address,corrected,'range failed again',now+8);store.refreshBase(p,now+8);
    assert.equal(store.alerts().alerts.length,2,'repeated qualification changes do not resend the same loss alert');
    assert.equal(store.unreadAlerts(),0,'a read coin is not made unread by the same repeated loss');
    assert.equal(store.feedback(p.address).length,0,'automatic assessment is never a human label');
  }finally{store.close();}
});
test('either fresh candles or any final eligibility check admits immediately, exactly once',()=>{
  const {p,bars,episodes,now}=fixture(), source=new Store(':memory:');
  source.discover(p);passChecks(source,p,now);
  const checks=[(s:Store)=>s.saveSecurity(source.security(p.mint)),(s:Store)=>s.saveTrading(source.trading(p)),
    (s:Store)=>s.saveSupplyOrigin(source.supplyOrigin(p.mint)!), (s:Store)=>s.saveProtection(source.protection(p,now))];
  try {
    for(let last=0;last<checks.length;last++) {
      const s=new Store(':memory:');
      try {
        s.discover(p);s.saveCandles(p.address,bars,'isolated fixture',now);s.recordSignals(p,episodes.map(e=>e.signal),now);
        checks.forEach((save,i)=>{if(i!==last)save(s);});
        assert.equal(s.unreadAlerts(),0,`pending check ${last} must withhold`);
        checks[last](s);
        assert.equal(s.unreadAlerts(),1,`final check ${last} must admit immediately`);
        checks[last](s);s.observeGroups(now+1);s.refreshBase(p,now+1);
        assert.equal(s.unreadAlerts(),1);
      }finally{s.close();}
    }
    const s=new Store(':memory:');
    try {
      s.discover(p);passChecks(s,p,now);s.saveCandles(p.address,bars,'isolated fixture',now);
      s.recordSignals(p,episodes.map(e=>e.signal),now);
      assert.equal(s.unreadAlerts(),1,'fresh candles admit with existing checks');
      assert.equal(s.alerts().alerts[0].observedAt,now);
      assert.ok(shortlisted(s.candidates(now)[0],now));
    }finally{s.close();}
  }finally{source.close();}
});
test('a later surge is not needed for admission and cannot admit an old base after price has left it',()=>{
  const {p,bars,episodes,now}=fixture(), s=new Store(':memory:');
  try {
    const outside={...p,price:p.price!*3};
    s.discover(outside);s.saveCandles(p.address,bars,'isolated fixture',now);
    s.recordSignals(outside,episodes.map(e=>e.signal),now);passChecks(s,outside,now);
    assert.equal(currentBase(s.base(p.address),now),true,'the stored candle pattern exists');
    assert.equal(shortlisted(s.candidates(now)[0],now),false,'newer price has already left that pattern');
    assert.equal(s.unreadAlerts(),0);
    s.updateMetrics({...p,metricsAt:now+1},now+1);
    assert.equal(s.unreadAlerts(),1,'a fresh price in the base is the final evidence');
    assert.equal(s.candidates(now+1)[0].shortlistedAt,now+1);
    const snapshot=s.activity('shortlist',p.mint).events.find(e=>e.summary==='Consolidation qualified for review')!;
    s.updateMetrics({...outside,metricsAt:now+2},now+2);
    assert.equal(shortlisted(s.candidates(now+2)[0],now+2),false);
    assert.equal(inResearchWatchlist(s.candidates(now+2)[0],now+2),true,'the earlier admission remains available to follow');
    assert.deepEqual(s.activity('shortlist',p.mint).events.find(e=>e.summary===snapshot.summary)?.data,snapshot.data,'later price never rewrites formation evidence');
  }finally{s.close();}
});
test('an early automatic non-match remains observable and can qualify hours later without another pump',()=>{
  const {p,bars,now}=fixture(8),s=new Store(':memory:'),early=bars.slice(0,10),firstAt=(early.at(-1)!.time+331)*1000;
  try {
    s.discover({...p,metricsAt:firstAt});s.saveCandles(p.address,early,'isolated early observation',firstAt);
    s.recordSignals(p,detectEpisodes(early,firstAt),firstAt);
    assert.notEqual(s.base(p.address)?.status,'qualified');
    assert.equal(s.candidate(p.mint)?.archived,false);
    assert.equal(s.unreadAlerts(),0);
    s.updateMetrics(p,now);passChecks(s,p,now);
    s.saveCandles(p.address,bars,'isolated later observation',now);
    s.recordSignals(p,detectEpisodes(bars,now),now);
    assert.equal(s.base(p.address)?.status,'qualified');assert.equal(s.base(p.address)?.durationHours,8);
    assert.equal(s.candidate(p.mint)?.archived,false);
    assert.equal(shortlisted(s.candidates(now)[0],now),true);
    assert.equal(s.unreadAlerts(),1);assert.equal(s.alerts().alerts[0].observedAt,now);
    assert.equal(s.episodes(p.mint).length,1,'the original rise is enough; no second pump required');
  }finally{s.close();}
});
test('latest price must be within the sideways or projected rising band, with no future or stale observation',()=>{
  const f=slopeFixture(), base=assessBase(f.p,f.bars,f.episodes,f.now), at=base.end!+15*60_000;
  const factor=Math.pow(1+base.trendPercentPerHour!/100,.25);
  const p={...f.p,price:(base.floor!+base.ceiling!)/2*factor,metricsAt:at};
  assert.equal(priceWithinBase(base,p,at),true);
  assert.equal(priceWithinBase(base,{...p,price:p.price*2},at),false);
  assert.equal(priceWithinBase(base,{...p,price:null},at),false);
  assert.equal(priceWithinBase(base,{...p,metricsAt:base.end!-1},at),false);
  assert.equal(priceWithinBase(base,{...p,metricsAt:at+1},at),false);
  assert.equal(priceWithinBase(base,{...p,metricsAt:at+3_600_000},at+3_600_000),false);
});
test('unfollowed preliminary charts log market-cap changes without notifications',()=>{
  const {p,episodes,now}=fixture(),store=new Store(':memory:');
  try {
    store.discover(p);store.recordSignals(p,episodes.map(e=>e.signal),now);
    for(const [i,cap] of [20_000,60_000,270_000].entries())store.updateMetrics({...p,marketCap:cap,metricsAt:now+i+1},now+i+1);
    assert.equal(store.unreadAlerts(),0);assert.equal(store.detail(p.address)!.crossings.length,3);
    assert.equal(shortlisted(store.candidates(now+4)[0],now+4),false);
  }finally{store.close();}
});
