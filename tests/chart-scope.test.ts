import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../server/store.ts';
import { Collector } from '../server/collector.ts';
import { blankPool, geckoCandles } from '../server/providers.ts';
import { closedCandles } from '../server/detector.ts';
import { marketCapFactor, scaleChart } from '../shared/chart.ts';
import { capRange } from '../shared/ranges.ts';
import { comparePools } from '../server/pool-context.ts';
const now=1_790_520_000_000;
test('one-minute data preserves real minute boundaries and stays separate from detector candles',()=>{
  const store=new Store(':memory:'),p=blankPool('Pool','Mint','Raydium',now);store.discover(p);
  const start=Math.floor(now/300_000)*300-600;
  const payload={meta:{base:{address:p.mint}},data:{attributes:{ohlcv_list:[0,1,2,3,4,5,6,7,8,9,10].map(i=>[start+i*60,1,2,.5,1.5,100+i])}}};
  const bars=closedCandles(geckoCandles(payload,p.mint,1),now,1);assert.equal(bars.length,9);
  store.saveCandles(p.address,bars,'fixture-1m',now,1);
  assert.equal(store.candles(p.address).length,0);assert.equal(store.candles(p.address,1).length,9);
  store.saveCandles(p.address,[bars[0]],'fixture-5m',now);
  assert.equal(store.detail(p.address)!.candles.length,1);assert.equal(store.detail(p.address)!.candles1m.length,9);
  assert.equal(store.episodes(p.mint).length,0);store.close();
});
test('market-cap conversion preserves OHLC shape and USD volume without FDV substitution',()=>{
  const p={...blankPool('Pool','Mint','Raydium',now),marketCap:100_000,price:.0001,metricsAt:now,capBasis:'provider_reported' as const};
  const factor=marketCapFactor(p,now);assert.equal(factor,1_000_000_000);
  const bars=[{time:0,open:.0001,high:.0002,low:.00005,close:.00015,volume:37}];
  assert.deepEqual(scaleChart(bars,factor!)[0],{time:0,open:100_000,high:200_000,low:50_000,close:150_000,volume:37});
  assert.equal(bars[0].open,.0001);
  for(const patch of [{capBasis:'fdv_only' as const},{price:0},{marketCap:null},{price:NaN},{metricsAt:now+1}])assert.equal(marketCapFactor({...p,...patch},now),null);
});
test('range boundaries use token market cap, inclusive 30k and 250k',()=>{
  assert.equal(capRange(29_999),'below');assert.equal(capRange(30_000),'within');assert.equal(capRange(250_000),'within');assert.equal(capRange(250_001),'above');assert.equal(capRange(NaN),'unknown');
});
test('paused Meteora and low-liquidity pools keep evidence but get no normal monitoring',()=>{
  const store=new Store(':memory:'),collector=new Collector(store),p={...blankPool('Pool','Mint','Meteora',now),metricsAt:now,marketCap:99_000};store.discover(p);
  const candidate={mint:p.mint,pool:p.address,qualifiedAt:now,reviewed:false,pinned:false,archived:false,below:false,lastCapAt:null,label:'',updatedAt:now};store.saveCandidate(candidate);
  assert.equal(store.group(candidate,now),'parked');assert.equal(collector.metricDue(p,now),false);assert.equal(collector.candleDue(p,now),false);
  assert.throws(()=>collector.queueRefresh(p.address),/paused/);assert.throws(()=>collector.watchMinuteChart(p.address,now),/paused/);
  store.updateMetrics({...p,marketCap:500_000},now);assert.equal(store.unreadAlerts(),0);assert.ok(store.pool(p.address));
  const low={...p,address:'LowPool',mint:'LowMint',venue:'PumpSwap' as const,liquidity:0,lastAttempt:now};store.discover(low);
  assert.equal(collector.candleDue(low,now),false);assert.equal(collector.metricDue(low,now+60_000),false);assert.equal(collector.metricDue(low,now+3_600_000),true);
  assert.throws(()=>collector.watchMinuteChart(low.address,now),/disregarded/);store.close();
});
test('DLMM context selects deepest same-mint PumpSwap/Raydium pool and keeps creation timing',()=>{
  const primary={...blankPool('Main','Mint','PumpSwap',now),liquidity:58_000,metricsAt:now,createdAt:now-3_600_000};
  const dlmm={...primary,address:'Context',venue:'Meteora' as const,route:'DLMM',liquidity:14_000,createdAt:now-1800_000};
  const small={...primary,address:'Small',venue:'Raydium' as const,liquidity:2_000};
  const impostor={...primary,address:'WrongMint',mint:'Other',liquidity:1_000_000};
  const context=comparePools(primary.mint,[primary,dlmm,small,impostor],now);
  assert.equal(context.preferredPool,'Main');assert.equal(context.pools.length,3);assert.equal(context.pools.find(p=>p.address==='Context')!.createdAt,dlmm.createdAt);
  assert.equal(comparePools(primary.mint,[{...primary,liquidity:0},dlmm,small],now).preferredPool,'Small');
  assert.equal(comparePools(primary.mint,[{...primary,metricsAt:now-120001},dlmm,{...small,liquidity:999}],now).preferredPool,null);
});
