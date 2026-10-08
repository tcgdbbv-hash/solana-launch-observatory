import test from 'node:test';
import assert from 'node:assert/strict';
import { Collector, Deferred } from '../server/collector.ts';
import { Store } from '../server/store.ts';
import { blankPool } from '../server/providers.ts';
import { assessBase } from '../server/base-detector.ts';
import type { Pool } from '../shared/types.ts';

const now=1_790_520_000_000;
function trackedBase(store:Store,address:string,priority=true):Pool {
  const p={...blankPool(address,`${address}-mint`,'PumpSwap',now-3_600_000),createdAt:now-3_600_000,
    liquidity:5000,metricsAt:now,candleAttempt:now-600_000};store.discover(p);
  store.saveCandidate({mint:p.mint,pool:p.address,qualifiedAt:now,reviewed:true,pinned:false,archived:false,below:null,lastCapAt:null,label:'',updatedAt:now});
  if(priority)store.set(`base:${p.address}`,{...assessBase(p,[],[],now),status:'qualified',candleEnd:now-600_000});
  return p;
}
test('formed bases take the priority candle turns while general coverage and provider deferrals retain their turns',async t=>{
  t.mock.method(Date,'now',()=>now);
  const store=new Store(':memory:');t.after(()=>store.close());
  const quiet={...blankPool('quiet-old','quiet-mint','PumpSwap',now-7_200_000),createdAt:now-7_200_000,liquidity:5000,metricsAt:now};store.discover(quiet);
  trackedBase(store,'early-pump',false);trackedBase(store,'base-a');trackedBase(store,'base-b');
  store.set('controlOffset',1);
  const collector=new Collector(store),served:string[]=[];
  const request=t.mock.method(collector,'request',async()=>{throw new Deferred('fixture cooldown');});
  await (collector as any).candles();
  assert.equal(store.get('controlOffset',0),1,'budget deferral must not spend a priority turn');
  request.mock.mockImplementation(async(_id:string,url:string)=>{
    const address=new URL(url).pathname.split('/')[6];served.push(address);
    const p=store.pool(address)!;
    return {meta:{base:{address:p.mint}},data:{attributes:{ohlcv_list:[[now/1000-600,1,1,1,1,.02]]}}};
  });
  await (collector as any).candles();await (collector as any).candles();await (collector as any).candles();
  assert.deepEqual(served,['base-a','base-b','quiet-old']);
});
test('priority base polling follows settled five-minute closes and never becomes a rapid repeat loop',t=>{
  t.mock.method(Date,'now',()=>now);
  const store=new Store(':memory:');t.after(()=>store.close());const p=trackedBase(store,'base');
  const collector=new Collector(store),base=store.base(p.address)!;
  const close=Math.floor((now-30_000)/300_000)*300_000;
  assert.equal(collector.candleDue({...p,candleAttempt:now-61_000},now),true);
  assert.equal(collector.candleDue({...p,candleAttempt:now-59_000},now),false);
  store.set(`base:${p.address}`,{...base,candleEnd:close});
  assert.equal(collector.candleDue(p,now),false,'no redundant requests for an already observed close');
  assert.equal(collector.candleDue(p,close+300_000+29_000),false);
  assert.equal(collector.candleDue(p,close+300_000+30_000),true);
  store.patchCandidate(p.mint,{archived:true},now);
  assert.equal(collector.candleDue(p,now+600_000),false);
});
test('a recently stale formed base keeps refresh priority without becoming current or skipping the background turn',async t=>{
  t.mock.method(Date,'now',()=>now);
  const store=new Store(':memory:');t.after(()=>store.close());
  const raw=trackedBase(store,'raw-pump',false),stale=trackedBase(store,'stale-base');
  store.savePool({...raw,candleAttempt:now-7_200_000});
  store.savePool({...stale,candleAttempt:now-1_200_000});
  store.set(`base:${stale.address}`,{...store.base(stale.address)!,candleEnd:now-3_600_000});
  store.set('controlOffset',2);
  const collector=new Collector(store),served:string[]=[];
  t.mock.method(collector,'request',async(_id:string,url:string)=>{
    const address=new URL(url).pathname.split('/')[6];served.push(address);
    return {meta:{base:{address:store.pool(address)!.mint}},data:{attributes:{ohlcv_list:[[now/1000-600,1,1,1,1,.02]]}}};
  });
  await (collector as any).candles();await (collector as any).candles();
  assert.deepEqual(served,['stale-base','raw-pump']);assert.equal(store.unreadAlerts(),0);
});
test('quiet pools receive candle screening without a dollar-volume gate',async t=>{
  t.mock.method(Date,'now',()=>now);
  const store=new Store(':memory:');t.after(()=>store.close());
  const p={...blankPool('quiet-pool','quiet-mint','PumpSwap',now-3_600_000),createdAt:now-3_600_000,liquidity:5000,metricsAt:now,volume1h:2};store.discover(p);
  const collector=new Collector(store);let called=false;
  t.mock.method(collector,'request',async(id:string,url:string)=>{called=true;assert.equal(id,'gecko');assert.ok(url.includes('/quiet-pool/ohlcv/'));return {meta:{base:{address:p.mint}},data:{attributes:{ohlcv_list:[[now/1000-600,1,1,1,1,.02]]}}};});
  await (collector as any).candles();assert.equal(called,true);assert.equal(store.candles(p.address).length,1);
  assert.equal(store.unreadAlerts(),0);
});
test('backfill advances only to earlier real candles, persists exhaustion, and respects provider deferrals',async t=>{
  t.mock.method(Date,'now',()=>now);
  const store=new Store(':memory:');t.after(()=>store.close());
  const p={...blankPool('older-pool','older-mint','Raydium',now-86_400_000),createdAt:now-86_400_000,liquidity:20_000,metricsAt:now,candleAt:now};store.discover(p);
  const earliest=now/1000-3600;store.saveCandles(p.address,[{time:earliest,open:1,high:1,low:1,close:1,volume:1}],'fixture',now);
  const collector=new Collector(store);let calls=0;
  const request=t.mock.method(collector,'request',async()=>{throw new Deferred('fixture cooldown');});
  await (collector as any).candleHistory();assert.equal(store.get(`candleHistory:${p.address}`,null),null);
  request.mock.mockImplementation(async(_id:string,url:string)=>{
    calls++;assert.equal(Number(new URL(url).searchParams.get('before_timestamp')),earliest-1);
    return {meta:{base:{address:p.mint}},data:{attributes:{ohlcv_list:[[earliest-300,1,1,1,1,1],[earliest,1,1,1,1,1]]}}};
  });
  await (collector as any).candleHistory();assert.equal(store.candles(p.address).length,2);assert.equal(calls,1);
  await (collector as any).candleHistory();assert.equal(calls,1,'persisted cooldown prevents a hot loop');
  store.set(`candleHistory:${p.address}`,{nextAt:0,done:false,pages:1,issue:null});
  request.mock.mockImplementation(async()=>({meta:{base:{address:p.mint}},data:{attributes:{ohlcv_list:[]}}}));
  await (collector as any).candleHistory();assert.equal(store.get<any>(`candleHistory:${p.address}`,null).done,true);
  assert.match(store.get<any>(`candleHistory:${p.address}`,null).issue,/unverified/);
  assert.equal(store.unreadAlerts(),0);
});
