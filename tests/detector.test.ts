import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateCandles, closedCandles, detectEpisodes } from '../server/detector.ts';
import type { Candle } from '../shared/types.ts';

const start = 1_790_000_100; // UTC-aligned five-minute bucket.
export function history(closes: number[], volumes?: number[]): Candle[] {
  return closes.map((close,i) => ({ time: start+i*300, open: i ? closes[i-1] : close,
    high: Math.max(close,i?closes[i-1]:close)*1.05, low: Math.min(close,i?closes[i-1]:close)*.95,
    close, volume: volumes?.[i] ?? 100 }));
}
const asOf = (bars: Candle[]) => (bars.at(-1)!.time+331)*1000;

test('completed OHLCV values produce a volume-supported initial pump before any base', () => {
  const bars=history([1,1,1,1,1.4,2.2],[100,100,100,800,1000,1600]);
  const signals=detectEpisodes(bars,asOf(bars));
  assert.equal(signals.length,1); assert.equal(signals[0].volumeQualified,true);
  assert.equal(signals[0].stage,'Pump developing'); assert.equal(signals[0].rise,2.2);
  assert.equal(signals[0].volumeConfirmedAt,bars.at(-1)!.time+300);
});
test('does not use future bars or an unclosed candle to confirm a pump', () => {
  const bars=history([1,1,1,1,1.4,2.2],[100,100,100,800,1000,1600]);
  assert.equal(detectEpisodes(bars,(bars.at(-1)!.time+299)*1000).length,0);
  assert.equal(detectEpisodes(bars.slice(0,-1),asOf(bars)).length,0);
});
test('isolated wick, ordinary-volume rise, and gaps do not become supported pump matches', () => {
  const flat=history([1,1,1,1,1,1]); flat[4].high=20;
  assert.equal(detectEpisodes(flat,asOf(flat)).length,0);
  const ordinary=history([1,1,1,1,1.4,2.2]);
  assert.equal(detectEpisodes(ordinary,asOf(ordinary)).length,0);
  const gapped=history([1,1,1,1,1.4,2.2],[100,100,100,800,1000,1600]).filter((_,i)=>i!==4);
  assert.equal(detectEpisodes(gapped,asOf(gapped)).length,0);
});
test('no prior baseline remains provisional, not a divide-by-zero volume confirmation', () => {
  const bars=history([1,1.4,2.2],[5000,10000,20000]);
  const signal=detectEpisodes(bars,asOf(bars))[0];
  assert.equal(signal.volumeQualified,false); assert.equal(signal.volumeRatio,null);
  assert.equal(signal.volumeConfirmedAt,null);
});
test('pullback and severe collapse change current stage without removing the initial episode', () => {
  const bars=history([1,1,1,1,1.4,2.2,1.3,.15],[100,100,100,800,1000,1600,300,50]);
  const atPullback=detectEpisodes(bars.slice(0,-1),asOf(bars.slice(0,-1)))[0];
  assert.equal(atPullback.stage,'Pump + pullback');
  const all=detectEpisodes(bars,asOf(bars)); assert.equal(all.length,1);
  assert.equal(all[0].stage,'Deep retracement'); assert.equal(all[0].volumeQualified,true);
});
test('15-minute OHLCV aggregation preserves units and refuses incomplete intervals', () => {
  const aligned=Math.floor(start/900)*900;
  const bars=history([1,2,3,4,5,6]).map((c,i)=>({...c,time:aligned+i*300}));
  const result=aggregateCandles(bars,15); assert.equal(result.length,2);
  assert.equal(result[0].open,1); assert.equal(result[0].close,3); assert.equal(result[0].volume,300);
  assert.ok(Math.abs(result[0].high-3.15)<1e-12); assert.equal(aggregateCandles(bars.filter((_,i)=>i!==1),15).length,1);
});
test('duplicate/out-of-order provider candles normalize; invalid and future data are excluded', () => {
  const bars=history([1,2,3]);
  assert.equal(closedCandles([bars[2],bars[0],bars[1],bars[1]],asOf(bars)).length,3);
  assert.equal(closedCandles([{...bars[0],volume:-1}],asOf(bars)).length,0);
});
test('a gradual multi-hour rise uses the coin’s own small initial volume, independent of dollar scale',()=>{
  const closes=[1,1,1,...Array.from({length:36},(_,i)=>Math.pow(2.4,i/35))];
  const volumes=closes.map((_,i)=>i<3?.02:.2),bars=history(closes,volumes);
  const signals=detectEpisodes(bars,asOf(bars));
  assert.ok(signals.some(s=>s.volumeQualified));
  assert.ok(signals[0].trigger-signals[0].start>60*60);
  const scaled=detectEpisodes(history(closes,volumes.map(v=>v*10000)),asOf(bars));
  assert.equal(signals.length,scaled.length);assert.equal(signals[0].trigger,scaled[0].trigger);
  assert.ok(Math.abs(signals[0].volumeRatio!-scaled[0].volumeRatio!)<1e-10);
});
