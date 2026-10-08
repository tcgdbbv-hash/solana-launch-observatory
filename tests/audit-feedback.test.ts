import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../server/store.ts';
import { blankPool } from '../server/providers.ts';
import { detectEpisodes } from '../server/detector.ts';
const now=1_790_520_000_000;
const pool={...blankPool('PoolFixture','MintFixture','Raydium',now),metricsAt:now,marketCap:40_000};
const bars=[1,1,1,1,1.4,2.2].map((close,i)=>({time:Math.floor(now/300_000)*300-3600+i*300,open:close,high:close*1.1,low:close*.7,close,volume:i<3?100:1000}));
test('audit pagination, exact filtering, credential redaction and transaction rollback',()=>{
 const store=new Store(':memory:');
 for(let i=0;i<105;i++)store.audit('fixture','mint',`Event ${i}`,{api_key:'SECRET',authorization:'Bearer SECRET',nested:{privateKey:'SECRET'},value:i},now+i);
 const first=store.activity('fixture','mint');assert.equal(first.events.length,100);assert.equal(first.total,105);
 const second=store.activity('fixture','mint',first.nextBefore!);assert.equal(second.events.length,5);
 assert.equal(new Set([...first.events,...second.events].map(e=>e.id)).size,105);
 assert.ok(!JSON.stringify(first).includes('SECRET'));assert.equal([...store.auditExport('fixture','mint')].length,105);
 assert.throws(()=>store.transaction(()=>{store.audit('fixture','mint','Should roll back');store.transaction(()=>{throw new Error('fail');});}));
 assert.equal(store.activity('fixture','mint').total,105);store.close();
});
test('candle corrections retain previous evidence without repeating unchanged candle payloads',()=>{
 const store=new Store(':memory:');store.discover(pool);store.saveCandles(pool.address,bars,'fixture',now);
 store.saveCandles(pool.address,bars,'fixture',now+1);
 assert.equal((store.activity('candles').events[0].data as any).added.length,0);
 const changed={...bars[0],volume:999};store.saveCandles(pool.address,[changed],'fixture',now+2);
 const event=store.activity('candles').events[0].data as any;
 assert.equal(event.corrected[0].previous.volume,bars[0].volume);assert.equal(event.corrected[0].current.volume,999);store.close();
});
test('repeated human reviews preserve snapshots and count one formation, without changing detector or risk checks',()=>{
 const store=new Store(':memory:');store.discover(pool);store.saveCandles(pool.address,bars,'fixture',now);
 store.recordSignals(pool,detectEpisodes(bars,now),now);const settings=store.settings();
 const first={formation:'match' as const,base:'too_early' as const,scope:'in_scope' as const,reason:'good_structure',notes:'Looks right initially'};
 store.addFeedback(pool,first,now);store.addFeedback(pool,{...first,base:'forming',notes:'Later base forming'},now+1000);
 assert.equal(store.feedbackSummary().totalReviews,2);assert.equal(store.feedbackSummary().reviewedCharts,1);
 assert.equal(store.feedbackSummary().formationCounts.match,1);assert.equal(store.feedback(pool.address)[0].base,'forming');
 store.saveCandles(pool.address,[{...bars[0],volume:9999}],'fixture',now+2000);
 const records=[...store.feedbackExport()];assert.equal(records[0].snapshot.candles[0].volume,bars[0].volume);
 assert.equal(records[0].snapshot.episode.original.settings.riseMultiple,settings.riseMultiple);
 assert.deepEqual(store.settings(),settings);assert.equal(store.group(store.candidate(pool.mint)!,now),'pending');store.close();
});
test('unflagged imported charts can be labeled as missed setups; future candles never enter review snapshots',()=>{
 const store=new Store(':memory:');store.discover(pool);store.saveCandles(pool.address,[...bars,{...bars[0],time:now/1000+300}],'fixture',now);
 store.addFeedback(pool,{formation:'match',base:'established',scope:'in_scope',reason:'other',notes:'Missed by detector'},now);
 assert.equal(store.feedbackSummary().withoutDetection,1);assert.equal(store.candidate(pool.mint),null);
 assert.equal([...store.feedbackExport()][0].snapshot.candles.length,bars.length);store.close();
});
test('review snapshots retain unknown liquidity, supply and DLMM context separately from human chart labels',()=>{
 const store=new Store(':memory:');store.discover(pool);
 store.savePoolContext({mint:pool.mint,preferredPool:pool.address,checkedAt:now,source:'fixture',reason:'deepest exact mint',pools:[{address:'DLMMFixture',venue:'Meteora',route:'DLMM',liquidity:5000,createdAt:now-1000,observedAt:now}]});
 store.addFeedback(pool,{formation:'match',base:'still_pumping',scope:'in_scope',reason:'good_structure',notes:'Human structure judgment'},now);
 const snapshot=[...store.feedbackExport()][0].snapshot;
 assert.equal(snapshot.risk.liquidityProtection.status,'pending');assert.equal(snapshot.risk.supply.status,'pending');
 assert.equal(snapshot.poolContext.pools[0].route,'DLMM');assert.equal(store.feedback(pool.address)[0].formation,'match');
 assert.equal(store.feedback(pool.address)[0].base,'still_pumping');assert.equal(store.candidate(pool.mint),null);store.close();
});
