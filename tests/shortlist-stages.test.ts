import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Store } from '../server/store.ts';
import { blankPool } from '../server/providers.ts';
import { assessBase } from '../server/base-detector.ts';
import { shortlisted } from '../shared/research.ts';
import { shortlistStage, earlySignsRefreshEligible } from '../shared/shortlist.ts';
import { BASE_MAX_AGE } from '../shared/base.ts';
import type { CandidateRow } from '../shared/types.ts';

function example() {
  const f=JSON.parse(readFileSync(new URL('./fixtures/martians-before-breakout.json',import.meta.url),'utf8'));
  const now=f.asOf;
  const p={...blankPool(f.pool.address,f.pool.mint,f.pool.venue,now),...f.pool,
    metricsAt:now,price:f.candles.at(-1).close,marketCap:100_000,capBasis:'provider_reported' as const,
    liquidity:20_000,volume5m:100,buys:3,sells:3};
  const store=new Store(':memory:');
  store.discover(p);store.saveCandles(p.address,f.candles,'saved example',now);
  store.recordSignals(p,f.episodes.map((e:any)=>e.signal),now);
  const c=store.candidates(now)[0];
  assert.ok(c);c.base=assessBase(p,f.candles,f.episodes,now);
  assert.equal(c.base.status,'qualified');
  return {store,c,now};
}
function early(c:CandidateRow):CandidateRow {
  const row=structuredClone(c);
  row.base!.status='insufficient';
  row.episode.signal.stage='Pump + pullback';row.episode.signal.pullback=.5;
  return row;
}

test('the final tier remains exactly the original shortlist, including soft market-cap preferences',()=>{
  const {store,c,now}=example();
  try {
    const passed={...c,group:'new' as const,risk:{...c.risk,status:'passed' as const}};
    const cases:CandidateRow[]=[passed,c,{...passed,archived:true},{...passed,group:'excluded'},
      {...passed,researchTags:['not_matching']},
      {...passed,poolData:{...passed.poolData,marketCap:20_000},capRange:'below',group:'below'},
      {...passed,poolData:{...passed.poolData,marketCap:300_000},capRange:'above',group:'above'},
      {...passed,poolData:{...passed.poolData,price:passed.poolData.price!*5}},
      {...passed,poolData:{...passed.poolData,metricsAt:now-3_600_000}}];
    for(const row of cases)assert.equal(shortlistStage(row,now)==='ready',shortlisted(row,now));
    assert.equal(shortlistStage(passed,now),'ready');
    assert.equal(shortlistStage(c,now),'forming','a formed base awaiting checks belongs in the middle stage');
  }finally{store.close();}
});

test('an early observation can progress through all stages without changing saved tags or generating alerts',()=>{
  const {store,c,now}=example();
  try {
    const saved=JSON.stringify(store.candidate(c.mint)),alerts=store.alerts().alerts.length;
    const row=early(c);row.researchTags=['base_established'];
    assert.equal(shortlistStage(row,now),'early','human tags are not automatic qualification');
    row.base={...c.base!,status:'forming',floorTests:2,ceilingTests:1,reasons:['The floor and ceiling need more distinct tests.']};
    assert.equal(shortlistStage(row,now),'forming');
    row.base=c.base;assert.equal(shortlistStage(row,now),'forming','complete base still waits for checks');
    row.group='new';row.risk={...row.risk,status:'passed'};
    assert.equal(shortlistStage(row,now),'ready');
    assert.equal(JSON.stringify(store.candidate(c.mint)),saved);
    assert.equal(store.alerts().alerts.length,alerts);
  }finally{store.close();}
});

test('early tiers keep exclusions, scope, liquidity, freshness and same-pool evidence',()=>{
  const {store,c,now}=example();
  try {
    const row=early(c);assert.equal(shortlistStage(row,now),'early');
    const rejected:CandidateRow[]=[{...row,archived:true},{...row,researchTags:['not_matching']},
      {...row,group:'excluded'}, {...row,risk:{...row.risk,status:'excluded'}},
      {...row,poolData:{...row.poolData,venue:'Meteora'}},
      {...row,poolData:{...row.poolData,liquidity:999}}, {...row,poolData:{...row.poolData,liquidity:null}},
      {...row,poolData:{...row.poolData,metricsAt:now-3_600_000}},
      {...row,poolData:{...row.poolData,buys:0,sells:0,volume5m:0}},
      {...row,base:{...row.base!,candleEnd:now-BASE_MAX_AGE-1}},
      {...row,base:{...row.base!,candleEnd:now+1}},
      {...row,episode:{...row.episode,pool:'secondary-pool'}},
      {...row,episode:{...row.episode,signal:{...row.episode.signal,volumeQualified:false}}},
      {...row,episode:{...row.episode,signal:{...row.episode.signal,stage:'Pump developing',pullback:.05}}}];
    for(const rejectedRow of rejected)assert.equal(shortlistStage(rejectedRow,now),null);
  }finally{store.close();}
});

test('unstable, inactive, broken-out and stale ranges cannot masquerade as a base taking shape',()=>{
  const {store,c,now}=example();
  try {
    const row=early(c);
    row.base={...c.base!,status:'forming',floorTests:2,ceilingTests:1,reasons:['The floor and ceiling need more distinct tests.']};
    assert.equal(shortlistStage(row,now),'forming');
    for(const reason of ['A single jump dominates the apparent rising base.','The floor and ceiling are both falling; support is not holding.','The range is still too wide.']) {
      assert.equal(shortlistStage({...row,base:{...row.base,reasons:[reason]}},now),'early');
    }
    assert.equal(shortlistStage({...row,base:{...row.base,status:'inactive'}},now),null);
    assert.equal(shortlistStage({...row,base:{...row.base,candleEnd:now-BASE_MAX_AGE-1}},now),null);
    assert.equal(shortlistStage({...c,poolData:{...c.poolData,price:c.poolData.price!*4}},now),null,'a base left behind is not moved into an earlier tier');
    assert.notEqual(shortlistStage({...row,poolData:{...row.poolData,price:row.poolData.price!*4}},now),'forming');
  }finally{store.close();}
});

test('expired Early signs evidence earns only a bounded reassessment, never relaxed admission',()=>{
  const {store,c,now}=example();
  try {
    const row=early(c);assert.equal(earlySignsRefreshEligible(row,now),true);
    const stale={...row,base:{...row.base!,candleEnd:now-BASE_MAX_AGE-1}};
    assert.equal(earlySignsRefreshEligible(stale,now),true);assert.equal(shortlistStage(stale,now),null);
    const rejected:CandidateRow[]=[{...stale,archived:true},{...stale,researchTags:['not_matching']},
      {...stale,group:'excluded'}, {...stale,risk:{...stale.risk,status:'excluded'}},
      {...stale,poolData:{...stale.poolData,venue:'Meteora'}},
      {...stale,poolData:{...stale.poolData,liquidity:999}}, {...stale,poolData:{...stale.poolData,metricsAt:now-3_600_000}},
      {...stale,poolData:{...stale.poolData,buys:0,sells:0,volume5m:0}},
      {...stale,base:{...stale.base,candleEnd:now-86_400_001}}, {...stale,base:{...stale.base,candleEnd:now+1}},
      {...stale,base:{...stale.base,pool:'secondary'}}, {...stale,base:{...stale.base,status:'inactive'}},
      {...stale,base:{...stale.base,status:'qualified'}},
      {...stale,episode:{...stale.episode,pool:'secondary'}},
      {...stale,episode:{...stale.episode,signal:{...stale.episode.signal,volumeQualified:false}}},
      {...stale,episode:{...stale.episode,signal:{...stale.episode.signal,stage:'Pump developing'}}}];
    for(const r of rejected)assert.equal(earlySignsRefreshEligible(r,now),false);
  }finally{store.close();}
});
