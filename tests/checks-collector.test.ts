import test from 'node:test';
import assert from 'node:assert/strict';
import { Collector, Deferred } from '../server/collector.ts';
import { Store } from '../server/store.ts';
import { blankPool } from '../server/providers.ts';
import { pendingProtection } from '../server/liquidity.ts';
import { pendingSecurity, pendingTrading, TOKEN_2022, USDC } from '../server/security.ts';
import { tradingProgressLabel } from '../shared/checks.ts';

const epoch=1_790_520_000_000;
function pool(store:Store,name:string,followed=false) {
  const p={...blankPool(name,`${name}-mint`,'PumpSwap',epoch-3_600_000),liquidity:20_000,metricsAt:epoch};
  store.discover(p);store.saveCandidate({mint:p.mint,pool:p.address,manualWatch:followed,qualifiedAt:epoch,
    reviewed:false,pinned:false,archived:false,below:null,lastCapAt:null,label:'',updatedAt:epoch});
  return p;
}
test('simultaneous provider checks take their turns instead of being lost to short request spacing',async t=>{
  const store=new Store(':memory:');t.after(()=>store.close());const collector=new Collector(store);let calls=0;
  t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response(JSON.stringify({result:calls}),{status:200});});
  const results=await Promise.all(Array.from({length:4},()=>collector.request('rpc','https://example.invalid/rpc',
    {method:'POST',body:JSON.stringify({method:'getSlot'})})));
  assert.deepEqual(results.map(r=>r.result),[1,2,3,4]);assert.equal(calls,4);
  assert.equal(store.countRequests('rpc',Date.now()-60_000),4);
});
test('provider serialization preserves long rate-limit cooldowns and never bypasses the local request budget',async t=>{
  const store=new Store(':memory:');t.after(()=>store.close());const collector=new Collector(store);let calls=0;
  t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response('{}',{status:429,headers:{'Retry-After':'60'}});});
  const results=await Promise.allSettled([collector.request('rpc','https://example.invalid'),collector.request('rpc','https://example.invalid')]);
  assert.equal(calls,1);assert.equal(results[0].status,'rejected');
  assert.ok(results[1].status==='rejected'&&results[1].reason instanceof Deferred);
  for(let i=0;i<35;i++)store.request('rpc',Date.now());
  const next=new Collector(store);
  await assert.rejects(()=>next.request('rpc','https://example.invalid'),Deferred);assert.equal(calls,1);
});
test('keyless Jupiter calls are spaced for half a request per second and exhaustion headers defer the queue',async t=>{
  t.mock.method(Date,'now',()=>epoch);
  const previous=process.env.JUPITER_API_KEY;delete process.env.JUPITER_API_KEY;
  t.after(()=>{if(previous===undefined)delete process.env.JUPITER_API_KEY;else process.env.JUPITER_API_KEY=previous;});
  const store=new Store(':memory:');t.after(()=>store.close());const collector=new Collector(store);
  t.mock.method(globalThis,'fetch',async()=>new Response('{}',{status:200}));
  await collector.request('quotes','https://example.invalid');
  assert.equal((collector as any).providerNext.get('quotes'),epoch+2200);
  const next=new Collector(store);let calls=0;
  t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response('{}',{status:200,headers:{'x-ratelimit-remaining':'0','x-ratelimit-reset':String((epoch+120_000)/1000)}});});
  await next.request('quotes','https://example.invalid');await assert.rejects(()=>next.request('quotes','https://example.invalid'),Deferred);assert.equal(calls,1);
  await assert.rejects(()=>new Collector(store).request('quotes','https://example.invalid'),Deferred);assert.equal(calls,1,'restart preserves provider cooldown');
});
test('early discoveries do not consume Jupiter quotes; explicit review can request the check',async t=>{
  t.mock.method(Date,'now',()=>epoch);const store=new Store(':memory:');t.after(()=>store.close());const p=pool(store,'early');
  store.saveSecurity({...pendingSecurity(p.mint),status:'passed',program:TOKEN_2022,checkedAt:epoch});
  const collector=new Collector(store);let calls=0;
  t.mock.method(collector as any,'quote',async()=>{calls++;throw new Error('fixture route unavailable');});
  await (collector as any).tradeability();assert.equal(calls,0);
  collector.queueChecks(p.address);await (collector as any).tradeability();assert.equal(calls,1);
  assert.equal(store.trading(p).status,'pending','provider failure cannot pass or permanently exclude a coin');
});
test('fresh market data does not call a background trading check queued or reset its age',async t=>{
  t.mock.method(Date,'now',()=>epoch);const store=new Store(':memory:');t.after(()=>store.close());const p=pool(store,'background-status');
  store.saveSecurity({...pendingSecurity(p.mint),status:'passed',program:TOKEN_2022,checkedAt:epoch});
  store.saveTrading({...pendingTrading(p),checkedAt:epoch-3_600_000});
  const collector=new Collector(store);
  const before=collector.tradingProgress(p);
  assert.equal(before.state,'waiting_setup');assert.equal(tradingProgressLabel(before),'Trading check deferred');
  store.updateMetrics({...p,metricsAt:epoch},epoch);
  assert.deepEqual(collector.tradingProgress(store.pool(p.address)!),before);
  assert.equal(before.lastAttemptAt,epoch-3_600_000);
  store.patchCandidate(p.mint,{manualWatch:true},epoch);
  assert.equal(collector.tradingProgress(p).state,'queued','following schedules the actual check');
});
test('an explicit failed trading check retries after backoff and restart, then finishes without another click',async t=>{
  let now=epoch;t.mock.method(Date,'now',()=>now);const store=new Store(':memory:');t.after(()=>store.close());let p=pool(store,'retry');
  store.saveSecurity({...pendingSecurity(p.mint),status:'passed',program:TOKEN_2022,checkedAt:now});
  const collector=new Collector(store);collector.queueChecks(p.address);
  let failedCalls=0;
  t.mock.method(collector as any,'quote',async()=>{failedCalls++;assert.equal(collector.tradingProgress(p).state,'checking');throw new Error('temporary source error');});
  await (collector as any).tradeability();
  assert.equal(collector.tradingProgress(p).state,'retry_wait');
  assert.equal(collector.tradingProgress(p).nextAttemptAt,epoch+120_000);
  await (collector as any).tradeability();assert.equal(failedCalls,1,'no hot retry loop');
  const restarted=new Collector(store);let calls=0;
  t.mock.method(restarted as any,'quote',async(inputMint:string,outputMint:string,inAmount:string)=>{
    calls++;assert.equal(restarted.tradingProgress(p).state,'checking');
    return {inputMint,outputMint,inAmount,outAmount:inputMint===USDC?'123456':'24900000',priceImpactPercent:.1,pools:[p.address],router:'fixture',receivedAt:now};
  });
  now+=119_999;await (restarted as any).tradeability();assert.equal(calls,0);
  now+=2;p={...p,metricsAt:now};store.savePool(p);
  assert.equal(restarted.tradingProgress(p).state,'queued');
  await (restarted as any).tradeability();assert.equal(calls,2);
  assert.equal(store.trading(p).status,'passed');assert.equal(restarted.tradingProgress(p).state,'current');
  assert.equal(restarted.tradingProgress(p).lastQuoteAt,now);
  now+=300_001;p={...p,metricsAt:now};store.savePool(p);
  assert.equal(restarted.tradingProgress(p).state,'waiting_setup','completed one-off check does not consume quotes forever');
});
test('trading progress exposes missing prerequisites, provider backoff and paused scanning',async t=>{
  t.mock.method(Date,'now',()=>epoch);const store=new Store(':memory:');t.after(()=>store.close());const p=pool(store,'delayed',true);
  const collector=new Collector(store);
  assert.equal(collector.tradingProgress(p).state,'waiting_controls');
  store.saveSecurity({...pendingSecurity(p.mint),status:'passed',program:TOKEN_2022,checkedAt:epoch});
  assert.equal(collector.tradingProgress({...p,metricsAt:epoch-300_000}).state,'waiting_liquidity');
  store.set('providerCooldown:quotes',epoch+60_000);
  assert.equal(collector.tradingProgress(p).state,'rate_limited');
  assert.equal(collector.tradingProgress(p).nextAttemptAt,epoch+60_000);
  store.set('scanEnabled',false);assert.equal(collector.tradingProgress(p).state,'paused');
  store.set('scanEnabled',true);store.patchCandidate(p.mint,{archived:true},epoch);
  assert.equal(collector.tradingProgress(p).state,'inactive');
});
test('followed charts receive LP refresh before background checks; secondary pools do not waste normal check turns',async t=>{
  t.mock.method(Date,'now',()=>epoch);
  const store=new Store(':memory:');t.after(()=>store.close());
  const background=pool(store,'background'),followed=pool(store,'followed',true);
  store.saveProtection({...pendingProtection(followed),checkedAt:epoch-1_800_000});
  const secondary={...background,address:'secondary'};store.discover(secondary);
  const collector=new Collector(store),served:string[]=[];
  t.mock.method(collector as any,'rpc',async(_method:string,[address]:any[])=>{served.push(address);return {context:{slot:1},value:null};});
  await (collector as any).liquidityProtection();assert.deepEqual(served,['followed']);
  await (collector as any).liquidityProtection();assert.deepEqual(served,['followed','background']);
  await (collector as any).liquidityProtection();assert.equal(served.length,2);
  collector.queueChecks(secondary.address);
  await (collector as any).liquidityProtection();assert.equal(served.at(-1),'secondary','explicit inspection checks that exact secondary pool');
});
test('Recheck forces a fresh LP attempt, deduplicates clicks, and preserves proof and search cursors',async t=>{
  let now=epoch;t.mock.method(Date,'now',()=>now);
  const store=new Store(':memory:');t.after(()=>store.close());const p=pool(store,'selected',true);
  store.saveProtection({...pendingProtection(p),status:'passed',checkedAt:now-1000});
  store.saveSupplyOrigin({mint:p.mint,raw:'1000000000000000',decimals:6,signature:'saved-proof',slot:1,checkedAt:now-1000,source:'isolated fixture'});
  const search={pages:14,before:'saved-cursor',probes:['older-tx'],exhausted:false,nextAt:now+30_000,issue:'Searching'};
  store.set(`supplySearch:${p.mint}`,search);
  const collector=new Collector(store);let calls=0;
  t.mock.method(collector as any,'rpc',async()=>{calls++;return {context:{slot:1},value:null};});
  await (collector as any).liquidityProtection();assert.equal(calls,0,'fresh saved check is reused normally');
  const first=collector.queueChecks(p.address);assert.equal(first,now);
  now++;assert.equal(collector.queueChecks(p.address),first,'repeated clicks do not extend the request');
  await (collector as any).liquidityProtection();assert.equal(calls,1);
  await (collector as any).liquidityProtection();assert.equal(calls,1,'one refresh request does not create a hot loop');
  assert.equal(store.supplyOrigin(p.mint)?.signature,'saved-proof');
  assert.deepEqual(store.get(`supplySearch:${p.mint}`,null),search);
  assert.equal(store.detail(p.address)?.checksRequestedAt,first);
  assert.equal(store.detail(p.address)?.supplySearch?.pages,14);
  assert.equal(store.activity('review',p.mint).events.filter(e=>e.summary.startsWith('Verification refresh requested')).length,1);
  store.patchCandidate(p.mint,{archived:true},now);assert.throws(()=>collector.queueChecks(p.address));
});
test('followed supply work gets attention without restarting its older-history search',async t=>{
  t.mock.method(Date,'now',()=>epoch);
  const store=new Store(':memory:');t.after(()=>store.close());const old=pool(store,'old'),chosen=pool(store,'chosen',true);
  for(const p of [old,chosen])store.saveSecurity({...pendingSecurity(p.mint),status:'passed',program:TOKEN_2022,decimals:6,supplyRaw:'950000000000000',checkedAt:epoch});
  store.set(`supplySearch:${chosen.mint}`,{pages:14,before:'cursor-14',probes:[],exhausted:false,nextAt:epoch-1000,issue:'Searching'});
  const collector=new Collector(store);let called=false;
  t.mock.method(collector as any,'rpc',async(method:string,[mint,options]:any[])=>{
    called=true;assert.equal(method,'getSignaturesForAddress');assert.equal(mint,chosen.mint);assert.equal(options.before,'cursor-14');return [];
  });
  await (collector as any).supplyOrigins();assert.equal(called,true);
  assert.equal(store.get<any>(`supplySearch:${chosen.mint}`,null).pages,15);
});
test('older-history probes request parsed v1 transactions and advance without inventing issuance proof',async t=>{
  t.mock.method(Date,'now',()=>epoch);
  const store=new Store(':memory:');t.after(()=>store.close());const p=pool(store,'v1-history',true);
  store.saveSecurity({...pendingSecurity(p.mint),status:'passed',program:TOKEN_2022,decimals:6,supplyRaw:'950000000000000',checkedAt:epoch});
  store.set(`supplySearch:${p.mint}`,{pages:20,before:'oldest',probes:['probe-1','probe-2'],exhausted:true,nextAt:epoch-1,issue:'Retrying',parserVersion:2});
  const collector=new Collector(store);
  t.mock.method(collector as any,'rpc',async(method:string,[signature,options]:any[])=>{
    assert.equal(method,'getTransaction');assert.equal(signature,'probe-1');assert.equal(options.maxSupportedTransactionVersion,1);
    return {version:1,slot:1,meta:{err:null,innerInstructions:[]},transaction:{signatures:[signature],message:{instructions:[],transactionConfig:{}}}};
  });
  await (collector as any).supplyOrigins();
  assert.deepEqual(store.get<any>(`supplySearch:${p.mint}`,null).probes,['probe-2']);
  assert.equal(store.supplyOrigin(p.mint),null);assert.equal(store.supply(p.mint,epoch).status,'pending');
});
