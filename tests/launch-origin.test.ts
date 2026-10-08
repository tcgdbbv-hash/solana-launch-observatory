import test from 'node:test';
import assert from 'node:assert/strict';
import { address, getAddressEncoder } from '@solana/addresses';
import { launchAddresses, parsePumpOrigin, parseLaunchLabOrigin, launchSupply, PUMP_PROGRAM, LAUNCHLAB_PROGRAM, STONK_PLATFORMS } from '../server/launch-origin.ts';
import { pendingSecurity, TOKEN_2022 } from '../server/security.ts';
import { PUMP_AMM } from '../server/liquidity.ts';
import { assessSupply } from '../server/supply.ts';
import { Collector } from '../server/collector.ts';
import { Store } from '../server/store.ts';
import { blankPool, SOL } from '../server/providers.ts';

const mint='5g9PWcRUHpmqm5uKycpShKXJB18sGLeCEzgB3qrRpump',other='9UtaRjir5Q4HRG8d8Z8F7jRgHGLBBwp7PR4rgBnoyr3z',now=1_790_520_000_000;
const controls=(m=mint)=>({...pendingSecurity(m),program:TOKEN_2022,status:'passed' as const,checkedAt:now,decimals:6,supplyRaw:'895488773894428'});
const account=(owner:string,b:Buffer)=>({owner,executable:false,data:[b.toString('base64'),'base64']});
const writeKey=(b:Buffer,offset:number,k:string)=>b.set(getAddressEncoder().encode(address(k)),offset);
async function pumpFixture() {
  const a=await launchAddresses(mint,SOL),curve=Buffer.alloc(151),dest=Buffer.alloc(301);
  curve.set([23,183,248,55,96,216,172,96]);curve.writeBigUInt64LE(1_000_000_000_000_000n,40);curve[48]=1;
  dest.set([241,154,109,4,17,177,109,188]);writeKey(dest,11,a.authority);writeKey(dest,43,mint);writeKey(dest,75,SOL);
  return {a,curve,dest,destination:()=>({...account(PUMP_AMM,dest),address:a.pumpDestination})};
}
test('Pump.fun canonical records prove burned-down starting supply and graduation without transaction history',async()=>{
  const f=await pumpFixture(),origin=await parsePumpOrigin(mint,f.a.pump,account(PUMP_PROGRAM,f.curve),f.destination(),controls(),42,now);
  assert.equal(origin?.graduated,true);assert.equal(origin?.destinationPool,f.a.pumpDestination);
  assert.equal(assessSupply(controls(),launchSupply(origin!),now).status,'passed');
  assert.equal(launchSupply(origin!)?.signature,undefined);
});
test('pool venue, spoofed owner, wrong mint PDA and truncated records never prove Pump origin',async()=>{
  const f=await pumpFixture();
  for(const [curve,addr] of [[account(PUMP_AMM,f.curve),f.a.pump],[account(PUMP_PROGRAM,f.curve.subarray(0,48)),f.a.pump],[account(PUMP_PROGRAM,f.curve),f.a.ray]] as const)
    assert.equal(await parsePumpOrigin(mint,addr,curve,f.destination(),controls(),42,now),null);
  writeKey(f.dest,11,other);
  const origin=await parsePumpOrigin(mint,f.a.pump,account(PUMP_PROGRAM,f.curve),f.destination(),controls(),42,now);
  assert.equal(origin?.platform,'Pump.fun');assert.equal(origin?.graduated,false,'a secondary pool cannot stand in for the migration destination');
});
test('variable and Mayhem issuance cannot receive a blanket one-billion pass',async()=>{
  const f=await pumpFixture();f.curve.writeBigUInt64LE(2_000_000_000_000_000n,40);
  let origin=await parsePumpOrigin(mint,f.a.pump,account(PUMP_PROGRAM,f.curve),f.destination(),controls(),42,now);
  assert.equal(assessSupply(controls(),launchSupply(origin!),now).status,'excluded');
  f.curve[81]=1;origin=await parsePumpOrigin(mint,f.a.pump,account(PUMP_PROGRAM,f.curve),f.destination(),controls(),42,now);
  assert.equal(origin?.platform,'Pump.fun');assert.equal(launchSupply(origin!),null);
});
async function rayFixture() {
  const a=await launchAddresses(other,SOL),b=Buffer.alloc(429);b.set([247,237,227,245,215,195,222,70]);b[17]=2;b[18]=6;b[20]=1;b[365]=1;
  b.writeBigUInt64LE(1_000_000_000_000_000n,21);writeKey(b,173,[...STONK_PLATFORMS][0]);writeKey(b,205,other);writeKey(b,237,SOL);
  return {a,b};
}
test('StonkFun is identified by its platform config inside the canonical LaunchLab account',async()=>{
  const {a,b}=await rayFixture();let origin=await parseLaunchLabOrigin(other,SOL,a.ray,account(LAUNCHLAB_PROGRAM,b),controls(other),42,now);
  assert.equal(origin?.platform,'StonkFun');assert.equal(origin?.graduated,true);assert.equal(origin?.initialRaw,'1000000000000000');
  b[17]=1;origin=await parseLaunchLabOrigin(other,SOL,a.ray,account(LAUNCHLAB_PROGRAM,b),controls(other),42,now);assert.equal(origin?.graduated,false);
  writeKey(b,173,mint);origin=await parseLaunchLabOrigin(other,SOL,a.ray,account(LAUNCHLAB_PROGRAM,b),controls(other),42,now);assert.equal(origin?.platform,'Raydium LaunchLab');
  writeKey(b,205,mint);assert.equal(await parseLaunchLabOrigin(other,SOL,a.ray,account(LAUNCHLAB_PROGRAM,b),controls(other),42,now),null);
});
test('launch lookup batches coins, replaces exhausted history with direct proof, and reuses saved graduation',async t=>{
  t.mock.method(Date,'now',()=>now);const store=new Store(':memory:');t.after(()=>store.close());
  const f=await pumpFixture(),r=await rayFixture();
  for(const [m,venue,poolAddress] of [[mint,'PumpSwap',f.a.pumpDestination],[other,'Raydium',r.a.ray]] as const){
    const p={...blankPool(poolAddress,m,venue,now),quoteMint:SOL,liquidity:20_000,metricsAt:now};store.discover(p);
    store.saveCandidate({mint:m,pool:poolAddress,qualifiedAt:now,reviewed:false,pinned:false,archived:false,below:null,lastCapAt:null,label:'',updatedAt:now});store.saveSecurity(controls(m));
  }
  const history={pages:20,probes:[],exhausted:true,nextAt:now+9999,issue:'Old limit reached'};store.set(`supplySearch:${mint}`,history);
  const collector=new Collector(store);let calls=0;
  const values=new Map<string,ReturnType<typeof account>>([[f.a.pump,account(PUMP_PROGRAM,f.curve)],[f.a.pumpDestination,account(PUMP_AMM,f.dest)],[r.a.ray,account(LAUNCHLAB_PROGRAM,r.b)]]);
  t.mock.method(collector as any,'rpc',async(method:string,[addresses,options]:any[])=>{calls++;assert.equal(method,'getMultipleAccounts');assert.equal(options.commitment,'finalized');assert.equal(addresses.length,6);return {context:{slot:42},value:addresses.map((a:string)=>values.get(a)??null)};});
  await (collector as any).launchOrigins();assert.equal(calls,1);assert.equal(store.supply(mint,now).status,'passed');assert.equal(store.supply(other,now).status,'passed');
  await (collector as any).launchOrigins();await (collector as any).supplyOrigins();assert.equal(calls,1);assert.deepEqual(store.get(`supplySearch:${mint}`,null),history);
  assert.equal(store.detail(f.a.pumpDestination)?.launchOrigin?.graduated,true);
});
test('missing launch accounts remain unverified and misses are cached without recurring history crawls',async t=>{
  t.mock.method(Date,'now',()=>now);const store=new Store(':memory:');t.after(()=>store.close());const f=await pumpFixture();
  const p={...blankPool(f.a.pumpDestination,mint,'PumpSwap',now),quoteMint:SOL,liquidity:20_000,metricsAt:now};store.discover(p);
  store.saveCandidate({mint,pool:p.address,qualifiedAt:now,reviewed:false,pinned:false,archived:false,below:null,lastCapAt:null,label:'',updatedAt:now});store.saveSecurity(controls());
  const collector=new Collector(store);let calls=0;
  t.mock.method(collector as any,'rpc',async()=>{calls++;return {context:{slot:42},value:[null,null,null]};});
  await (collector as any).launchOrigins();await (collector as any).launchOrigins();await (collector as any).supplyOrigins();
  assert.equal(calls,1);assert.equal(store.supply(mint,now).status,'pending');assert.equal(store.get(`launchOrigin:${mint}`,null),null);
});
test('StonkFun API labels only supply lookup hints and are never sufficient to pass issuance or graduation',async t=>{
  t.mock.method(Date,'now',()=>now);const store=new Store(':memory:');t.after(()=>store.close());
  const p={...blankPool('secondary',other,'Raydium',now),quoteMint:SOL,liquidity:20_000,metricsAt:now};store.discover(p);
  store.saveCandidate({mint:other,pool:p.address,qualifiedAt:now,reviewed:false,pinned:false,archived:false,below:null,lastCapAt:null,label:'',updatedAt:now});store.saveSecurity(controls(other));
  const collector=new Collector(store);let calls=0;
  t.mock.method(collector,'request',async(id:string,url:string)=>{calls++;assert.equal(id,'stonk');assert.ok(url.endsWith('/tokens/'+other));return {data:{token:{mint:other,launchpad:'launchlab',status:'graduated',quote:{mint:SOL}}}};});
  await (collector as any).stonkOriginHints();await (collector as any).stonkOriginHints();
  assert.equal(calls,1);assert.equal(store.supply(other,now).status,'pending');assert.equal(store.get(`launchOrigin:${other}`,null),null);
  assert.equal(store.get<any>(`stonkHint:${other}`,null).quoteMint,SOL);
});
