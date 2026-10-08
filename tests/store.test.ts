import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { backup } from 'node:sqlite';
import { approveScopeChecks } from './scope-fixtures.ts';
import { Store } from '../server/store.ts';
import { blankPool } from '../server/providers.ts';
import { detectEpisodes } from '../server/detector.ts';
import type { Candle, Pool } from '../shared/types.ts';
import { TOKEN, RISK_POLICY, USDC, assessTrading, type ProgramEvidence, assessMint, parseQuote } from '../server/security.ts';
import { inResearchWatchlist, matchesWatchlist, awaitingChecksInRange } from '../shared/research.ts';

const now=1_790_520_000_000;
function setup(path=':memory:') {
  const store=new Store(path), p={...blankPool('Pool11111111111111111111111111111111111111','Mint11111111111111111111111111111111111111','PumpSwap',now),
    metricsAt:now,metricsSource:'test fixture',marketCap:60_000,liquidity:20_000,capBasis:'provider_reported' as const};
  store.discover(p);
  const program: ProgramEvidence={address:TOKEN,immutable:true,programData:'test-program-data',checkedAt:now,reason:'fixture'};
  store.saveSecurity(assessMint(p.mint,{owner:TOKEN,executable:false,space:82,data:{parsed:{type:'mint',info:{isInitialized:true,supply:'1000000000000000',decimals:6,mintAuthority:null,freezeAuthority:null}}}},program,now,1));
  const quote=(inputMint:string,outputMint:string,inAmount:string,outAmount:string)=>parseQuote({inputMint,outputMint,inAmount,outAmount,swapMode:'ExactIn',priceImpact:0.1,routePlan:[{swapInfo:{ammKey:p.address}}]},inputMint,outputMint,inAmount,now);
  const buy=quote(USDC,p.mint,RISK_POLICY.sampleUsdcRaw,'123456789'),sell=quote(p.mint,USDC,buy.outAmount,'24900000');
  store.saveTrading(assessTrading(p,buy,sell,now));approveScopeChecks(store,p,now);
  const bars: Candle[]=[1,1,1,1,1.4,2.2].map((close,i)=>({time:Math.floor(now/300_000)*300-3600+i*300,open:i>3?close*.8:close,high:close*1.1,low:close*.7,close,volume:i<3?100:1000}));
  const signals=detectEpisodes(bars,now);
  assert.equal(signals.length,1); store.recordSignals(p,signals,now);
  return {store,p,signals,bars};
}
function metric(store:Store,p:Pool,value:number|null,time:number,basis=p.capBasis) {store.updateMetrics({...p,marketCap:value,metricsAt:time,capBasis:basis},time);}

test('below $30k, recovery, exact boundary and repeated observations preserve one candidate',()=>{
  const {store,p}=setup(); metric(store,p,29_000,now+1000);
  assert.equal(store.candidates(now+10_000)[0].group,'below'); assert.equal(store.episodes(p.mint).length,1);
  metric(store,p,28_000,now+2000); assert.equal(store.detail(p.address)!.crossings.length,1);
  metric(store,p,30_000,now+3000); assert.equal(store.candidates(now+10_000)[0].group,'new');
  store.patchCandidate(p.mint,{reviewed:true},now+4000);
  metric(store,p,20_000,now+5000); metric(store,p,31_000,now+6000);
  assert.equal(store.candidates(now+10_000)[0].group,'watching'); assert.equal(store.detail(p.address)!.crossings.length,4); store.close();
});
test('unknown, stale, zero and FDV values never manufacture threshold crossings',()=>{
  const {store,p}=setup();
  metric(store,p,null,now+1000); metric(store,p,0,now+2000); metric(store,p,10_000,now+3000,'fdv_only');
  store.updateMetrics({...p,marketCap:10_000,metricsAt:now-600_000},now+4000);
  assert.equal(store.candidates(now+10_000)[0].group,'pending'); assert.equal(store.candidate(p.mint)!.below,false); assert.equal(store.detail(p.address)!.crossings.length,0);
  metric(store,p,25_000,now+5000); metric(store,p,null,now+6000);
  assert.equal(store.candidates(now+10_000)[0].group,'below'); store.close();
});
test('pinning and months of age do not override below grouping or expire the candidate',()=>{
  const {store,p}=setup(); metric(store,p,20_000,now+1000);
  store.patchCandidate(p.mint,{pinned:true},now+120*86400_000);
  assert.equal(store.candidates(now+10_000).length,1); assert.equal(store.candidates(now+10_000)[0].group,'below'); store.close();
});
test('numeric range stays separate from provisional volume, and first observations are truthful',()=>{
  const {store,p,signals}=setup(); const second={...p,address:'OtherPool',mint:'OtherMint',marketCap:10_000};store.discover(second);
  store.recordSignals(second,[{...signals[0],volumeQualified:false,volumeRatio:null,volumeConfirmedAt:null}],now);
  assert.equal(store.candidate(second.mint)!.below,true);
  assert.equal(store.episodes(second.mint)[0].signal.volumeQualified,false);
  store.recordSignals(second,signals,now+1000);
  assert.equal(store.detail(second.address)!.crossings[0].kind,'First observed below $30k');store.close();
});
test('archive/restore is reversible and user reviews persist independently of price',()=>{
  const {store,p}=setup();store.addNote(p.mint,'Review fixture: original evidence must remain.','Possible base',now+1);
  store.patchCandidate(p.mint,{archived:true},now+2);metric(store,p,10_000,now+3);
  assert.equal(store.candidates(now+10_000)[0].group,'archived');
  store.patchCandidate(p.mint,{archived:false},now+4);
  assert.equal(store.candidates(now+10_000)[0].group,'below');assert.equal(store.detail(p.address)!.notes.length,1);store.close();
});
test('duplicate delivery, repeated episodes and later criteria changes cannot erase original qualification',()=>{
  const {store,p,signals}=setup(); const original=JSON.stringify(store.episodes(p.mint)[0].original);
  store.recordSignals(p,signals,now+1);assert.equal(store.candidates(now+10_000).length,1);assert.equal(store.episodes(p.mint).length,1);
  store.recordSignals(p,[{...signals[0],volumeQualified:false,volumeRatio:null,stage:'Deep retracement'}],now+2);
  assert.equal(store.episodes(p.mint)[0].signal.volumeQualified,true);
  assert.equal(JSON.stringify(store.episodes(p.mint)[0].original),original);
  store.recordSignals(p,[{...signals[0],trigger:signals[0].trigger+86400,start:signals[0].start+86400}],now+3);
  assert.equal(store.episodes(p.mint).length,2);assert.equal(store.candidates(now+10_000).length,1);store.close();
});
test('pool registry includes nonmatches; stored state and an online backup survive reopening',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'observatory-test-'));const path=join(dir,'live.sqlite');
  try {
    const {store,p,bars}=setup(path);store.discover({...p,address:'UnmatchedPool',mint:'UnmatchedMint'});
    store.saveCandles(p.address,bars,'test fixture',now);store.set('cursor',{signature:'test checkpoint'});
    await backup(store.db,join(dir,'backup.sqlite'));store.close();
    const restored=new Store(join(dir,'backup.sqlite'));
    assert.equal(restored.pools().length,2);assert.equal(restored.candidates().length,1);
    assert.equal(restored.candles(p.address).length,6);assert.deepEqual(restored.get('cursor',null),{signature:'test checkpoint'});restored.close();
    const reopened=new Store(path);assert.equal(reopened.pools().length,2);reopened.close();
  } finally {rmSync(dir,{recursive:true,force:true});}
});
test('above-range alerts, re-entry and stable chart IDs retain reviews and never duplicate same-band observations',()=>{
  const {store,p}=setup(), code=store.chartCode(p.address);
  assert.equal(store.unreadAlerts(),0);store.patchCandidate(p.mint,{reviewed:true,pinned:true,manualWatch:true},now+1);
  metric(store,p,250_001,now+1000);assert.equal(store.candidates(now+5000)[0].group,'above');
  metric(store,p,500_000,now+2000);metric(store,p,500_000,now+2000);assert.equal(store.unreadAlerts(),1);
  metric(store,p,250_000,now+3000);assert.equal(store.candidates(now+5000)[0].group,'watching');assert.equal(store.candidate(p.mint)!.pinned,true);
  assert.equal(store.alerts().alerts[0].message,'Returned to $30k–$250k');assert.equal(store.alerts().alerts[0].chartCode,code);
  const through=store.alerts().alerts[0].id;metric(store,p,29_999,now+4000);
  store.markAlertsRead(through,now+5000);assert.equal(store.unreadAlerts(),1);assert.equal(store.alerts().alerts[0].readAt,null);
  store.markAlertsRead(store.alerts().alerts[0].id,now+6000,true);assert.equal(store.unreadAlerts(),0);
  store.savePool({...store.pool(p.address)!,symbol:'Renamed'});assert.equal(store.chartCode(p.address),code);store.close();
});
test('secondary pools, future and out-of-order caps do not produce range transitions; ignored liquidity suppresses alerts',()=>{
  const {store,p}=setup();store.patchCandidate(p.mint,{manualWatch:true},now+1);metric(store,p,260_000,now+2000);
  store.updateMetrics({...p,marketCap:20_000,metricsAt:now+1000},now+3000);
  store.updateMetrics({...p,marketCap:20_000,metricsAt:now+5000},now+3000);
  store.updateMetrics({...p,address:'Secondary',marketCap:20_000,metricsAt:now+3000},now+3000);
  assert.equal(store.unreadAlerts(),1);assert.equal(store.candidate(p.mint)!.capRange,'above');
  store.updateMetrics({...p,marketCap:20_000,metricsAt:now+4000,liquidity:0},now+4000);
  assert.equal(store.unreadAlerts(),1);assert.equal(store.candidates(now+5000)[0].group,'excluded');
  assert.ok(store.activity('liquidity').events.some(e=>e.summary.includes('disregarded')));store.close();
});
test('range alert IDs and unread state survive reopening and manual archives suppress new notifications',()=>{
  const dir=mkdtempSync(join(tmpdir(),'range-alert-'));
  try {
    const path=join(dir,'db.sqlite'), {store,p}=setup(path), code=store.chartCode(p.address);
    store.patchCandidate(p.mint,{manualWatch:true},now+1);
    metric(store,p,260_000,now+1000);const id=store.alerts().alerts[0].id;store.close();
    const reopened=new Store(path);assert.equal(reopened.chartCode(p.address),code);assert.equal(reopened.unreadAlerts(),1);assert.equal(reopened.alerts().alerts[0].id,id);
    reopened.patchCandidate(p.mint,{archived:true},now+2000);metric(reopened,p,50_000,now+3000);assert.equal(reopened.unreadAlerts(),1);
    assert.equal(reopened.candidate(p.mint)!.capRange,'within');reopened.close();
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('manual research tags allow pending coins in overlapping watchlist and cap views without passing checks',()=>{
  const {store,p}=setup();store.set(`supplyOrigin:${p.mint}`,null);
  const before=store.risk(p,now), original=JSON.stringify(store.episodes(p.mint));
  assert.equal(store.candidates(now)[0].group,'pending');assert.equal(matchesWatchlist(store.candidates(now)[0],'all',now),false);
  store.patchCandidate(p.mint,{manualWatch:true,researchTags:['watching_base','base_forming']},now+1);
  let row=store.candidates(now+10)[0];
  for(const filter of ['all','manual','watching','base_forming','within','pending'] as const)assert.equal(matchesWatchlist(row,filter,now+10),true,filter);
  for(const filter of ['base_established','revisit','not_matching'] as const)assert.equal(matchesWatchlist(row,filter,now+10),false,filter);
  assert.deepEqual(store.risk(p,now),before);assert.equal(JSON.stringify(store.episodes(p.mint)),original);
  metric(store,p,300_000,now+1000);row=store.candidates(now+1001)[0];
  assert.equal(matchesWatchlist(row,'above',now+1001),true);assert.equal(matchesWatchlist(row,'watching',now+1001),true);assert.equal(matchesWatchlist(row,'within',now+1001),false);
  metric(store,p,25_000,now+2000);row=store.candidates(now+2001)[0];assert.equal(matchesWatchlist(row,'below',now+2001),true);
  metric(store,p,40_000,now+3000);row=store.candidates(now+3001)[0];assert.equal(matchesWatchlist(row,'within',now+3001),true);assert.equal(row.group,'pending');
  assert.deepEqual(row.researchTags,['watching_base','base_forming']);store.close();
});

test('in-range awaiting-checks view exposes fresh pending detections without adding them to the active watchlist',()=>{
  const {store,p}=setup();
  try {
    store.set(`supplyOrigin:${p.mint}`,null);
    const row=store.candidates(now)[0];assert.equal(awaitingChecksInRange(row,now),true);
    assert.equal(matchesWatchlist(row,'within',now),false);assert.equal(inResearchWatchlist(row,now),false);
    assert.equal(awaitingChecksInRange(row,now+120_001),false);
    assert.equal(awaitingChecksInRange({...row,poolData:{...row.poolData,venue:'Meteora'}},now),false);
    assert.equal(awaitingChecksInRange({...row,poolData:{...row.poolData,liquidity:999}},now),false);
    assert.equal(awaitingChecksInRange({...row,archived:true},now),false);
    assert.equal(awaitingChecksInRange({...row,group:'excluded'},now),false);
    assert.equal(awaitingChecksInRange({...row,capRange:'above'},now),false);
    store.patchCandidate(p.mint,{manualWatch:true},now+1);
    assert.equal(awaitingChecksInRange(store.candidates(now+2)[0],now+2),false);
    assert.equal(store.candidates(now+2)[0].group,'pending');
  } finally {store.close();}
});

test('research selection never overrides hard liquidity, venue or archive pauses and can be removed independently',()=>{
  const {store,p}=setup();store.set(`supplyOrigin:${p.mint}`,null);
  store.patchCandidate(p.mint,{manualWatch:true,researchTags:['watching_base']},now);
  store.patchCandidate(p.mint,{manualWatch:false},now+1);
  assert.equal(inResearchWatchlist(store.candidates(now+2)[0],now+2),false);assert.deepEqual(store.candidate(p.mint)!.researchTags,['watching_base']);
  store.patchCandidate(p.mint,{manualWatch:true},now+3);
  store.updateMetrics({...p,liquidity:0,metricsAt:now+4},now+4);
  assert.equal(inResearchWatchlist(store.candidates(now+5)[0],now+5),false);
  assert.throws(()=>store.patchCandidate(p.mint,{manualWatch:true},now+6),/liquidity/);
  store.savePool({...p,venue:'Meteora'});assert.equal(inResearchWatchlist(store.candidates(now+7)[0],now+7),false);
  assert.throws(()=>store.patchCandidate(p.mint,{manualWatch:true},now+8),/in-scope/);
  store.savePool(p);store.patchCandidate(p.mint,{archived:true},now+9);
  assert.equal(inResearchWatchlist(store.candidates(now+10)[0],now+10),false);
  assert.throws(()=>store.patchCandidate(p.mint,{manualWatch:true},now+11),/Restore/);store.close();
});

test('research changes are validated, survive restart and preserve as-of labels and evidence for later AI review',()=>{
  const dir=mkdtempSync(join(tmpdir(),'research-tags-'));
  try {
    const path=join(dir,'db.sqlite'),{store,p,bars}=setup(path);store.saveCandles(p.address,bars,'fixture',now);
    assert.throws(()=>store.patchCandidate(p.mint,{researchTags:['made_up'] as any},now),/valid/);
    assert.throws(()=>store.patchCandidate(p.mint,{researchTags:['watching_base','watching_base']},now),/valid/);
    assert.throws(()=>store.patchCandidate(p.mint,{manualWatch:'true' as any},now),/Choose/);
    store.patchCandidate(p.mint,{manualWatch:true,researchTags:['watching_base']},now+1);
    store.addFeedback(p,{formation:'match',base:'forming',scope:'in_scope',reason:'good_structure',notes:'Isolated fixture'},now+2);
    store.patchCandidate(p.mint,{researchTags:['base_established']},now+3);
    const records=store.activity('review',p.mint).events.filter(e=>e.summary.includes('research watchlist'));
    assert.equal(records.length,2);assert.deepEqual((records[1].data as any).current.tags,['watching_base']);
    assert.equal((records[1].data as any).snapshot.candles.length,bars.length);
    assert.equal((records[1].data as any).snapshot.capRange,'within');
    assert.deepEqual([...store.feedbackExport()][0].snapshot.research,{manualWatch:true,tags:['watching_base']});
    store.close();const reopened=new Store(path);
    assert.equal(reopened.candidate(p.mint)!.manualWatch,true);assert.deepEqual(reopened.candidate(p.mint)!.researchTags,['base_established']);reopened.close();
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('Not my setup archives even eligible or manually followed coins, retains evidence and prevents range alerts or rediscovery from restoring them',()=>{
  const {store,p,signals,bars}=setup();
  try {
    store.saveCandles(p.address,bars,'fixture',now);
    store.addNote(p.mint,'Preserve my earlier assessment','Possible base',now);
    const risk=store.risk(p,now), episodes=store.episodes(p.mint);
    store.patchCandidate(p.mint,{manualWatch:true,researchTags:['base_forming','not_matching']},now+1);
    const row=store.candidates(now+2)[0];
    assert.equal(row.archived,true);assert.equal(row.manualWatch,false);assert.equal(row.group,'archived');
    for(const filter of ['all','manual','within','above','below','watching','base_forming','pending'] as const)assert.equal(matchesWatchlist(row,filter,now+2),false,filter);
    assert.equal(matchesWatchlist(row,'not_matching',now+2),true);assert.equal(matchesWatchlist(row,'archived',now+2),true);
    assert.deepEqual(store.risk(p,now),risk);assert.deepEqual(store.episodes(p.mint),episodes);assert.equal(store.detail(p.address)!.notes.length,1);
    const audit=store.activity('review',p.mint).events[0].data as any;
    assert.equal(audit.actor,'human');assert.equal(audit.current.archived,true);assert.equal(audit.current.manualWatch,false);
    assert.deepEqual(audit.current.tags,['base_forming','not_matching']);assert.equal(audit.snapshot.candles.length,bars.length);
    metric(store,p,300_000,now+1000);assert.equal(store.unreadAlerts(),0);
    store.recordSignals(store.pool(p.address)!,signals,now+1100);assert.equal(store.candidate(p.mint)!.archived,true);
    store.patchCandidate(p.mint,{pinned:true,manualWatch:true},now+1200);assert.equal(store.candidate(p.mint)!.manualWatch,false);
    assert.equal(store.group(store.candidate(p.mint)!,now+1300),'archived');
  } finally {store.close();}
});

test('restoring a rejected setup clears only its rejection tag and never passes pending checks',()=>{
  const {store,p}=setup();
  try {
    store.set(`supplyOrigin:${p.mint}`,null);
    store.patchCandidate(p.mint,{researchTags:['base_forming','not_matching']},now+1);
    store.patchCandidate(p.mint,{archived:false},now+2);
    let row=store.candidates(now+3)[0];
    assert.equal(row.archived,false);assert.equal(row.manualWatch,false);assert.equal(row.group,'pending');
    assert.deepEqual(row.researchTags,['base_forming']);assert.equal(matchesWatchlist(row,'not_matching',now+3),false);
    assert.equal(inResearchWatchlist(row,now+3),false);assert.equal(awaitingChecksInRange(row,now+3),true);
    store.patchCandidate(p.mint,{manualWatch:true},now+4);row=store.candidates(now+5)[0];
    assert.equal(inResearchWatchlist(row,now+5),true);assert.equal(row.risk.supply?.status,'pending');
    assert.ok(store.activity('review',p.mint).events.some(e=>(e.data as any)?.current?.tags?.includes('not_matching')));
  } finally {store.close();}
});

test('existing Not my setup labels migrate once with a policy audit and remain archived across restarts',()=>{
  const dir=mkdtempSync(join(tmpdir(),'research-archive-'));
  try {
    const path=join(dir,'db.sqlite'),{store,p}=setup(path);
    store.saveCandidate({...store.candidate(p.mint)!,manualWatch:true,researchTags:['not_matching']});store.close();
    const reopened=new Store(path);reopened.migrateResearchArchivePolicy(now+1);
    assert.equal(reopened.candidate(p.mint)!.archived,true);assert.equal(reopened.candidate(p.mint)!.manualWatch,false);
    const migration=reopened.activity('review',p.mint).events.filter(e=>(e.data as any)?.actor==='policy');
    assert.equal(migration.length,1);assert.deepEqual((migration[0].data as any).previous.tags,['not_matching']);
    assert.equal((migration[0].data as any).previous.archived,false);assert.equal((migration[0].data as any).current.archived,true);
    reopened.close();const restarted=new Store(path);restarted.migrateResearchArchivePolicy(now+2);
    assert.equal(restarted.group(restarted.candidate(p.mint)!,now+2),'archived');
    assert.equal(restarted.activity('review',p.mint).events.filter(e=>(e.data as any)?.actor==='policy').length,1);
    restarted.patchCandidate(p.mint,{archived:false},now+3);restarted.migrateResearchArchivePolicy(now+4);
    assert.equal(restarted.candidate(p.mint)!.archived,false);assert.deepEqual(restarted.candidate(p.mint)!.researchTags,[]);restarted.close();
  } finally {rmSync(dir,{recursive:true,force:true});}
});
