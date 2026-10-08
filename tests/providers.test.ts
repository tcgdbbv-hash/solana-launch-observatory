import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dexPool, geckoCandles, meteoraPool, SOL } from '../server/providers.ts';

test('real saved Meteora response gives honest volume windows and separates FDV from cap',()=>{
  const probes=JSON.parse(readFileSync('research/public-api-probes.json','utf8'));
  const raw=probes.find((p:any)=>p.name==='meteora_damm_v2').sample_rows[0];
  const p=meteoraPool(raw,'DAMM v2',Date.now())!;
  assert.ok(p);assert.notEqual(p.mint,SOL);assert.equal(p.volume5m,null);assert.equal(p.marketCap,null);
  assert.equal(p.origin,'Unknown');assert.equal(p.volume30m,0);
});
test('curve pairs cannot be mislabeled as PumpSwap; wrong pool orientation is rejected',()=>{
  const r={chainId:'solana',dexId:'pumpfun',pairAddress:SOL,baseToken:{address:SOL}};
  assert.equal(dexPool(r,Date.now()),null);
  const valid=dexPool({...r,dexId:'pumpswap',marketCap:null,fdv:29000},Date.now())!;
  assert.equal(valid.marketCap,null);assert.equal(valid.capBasis,'fdv_only');
  assert.equal(dexPool({...r,dexId:'pumpswap'},Date.now(),{...valid,mint:'DifferentMint'}),null);
});
test('candle metadata must identify the requested token',()=>{
  assert.throws(()=>geckoCandles({meta:{base:{address:'other'}},data:{attributes:{ohlcv_list:[]}}},SOL));
  const rows=[[1790523000,1,3,.5,2,100]];
  assert.equal(geckoCandles({meta:{base:{address:SOL}},data:{attributes:{ohlcv_list:rows}}},SOL)[0].volume,100);
});
