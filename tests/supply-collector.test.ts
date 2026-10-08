import test from 'node:test';
import assert from 'node:assert/strict';
import { Collector } from '../server/collector.ts';
import { Store } from '../server/store.ts';
import { blankPool } from '../server/providers.ts';
import { pendingSecurity, TOKEN_2022 } from '../server/security.ts';
import { SUPPLY_PARSER_VERSION } from '../server/supply.ts';
import { assessBase } from '../server/base-detector.ts';

const epoch=1_790_520_000_000;
function addCandidate(store:Store,mint:string,observedAt:number, followed=false) {
  const p={...blankPool(`Pool-${mint}`,mint,'PumpSwap',observedAt),liquidity:20_000,metricsAt:observedAt};
  store.discover(p);
  store.saveCandidate({mint,pool:p.address,qualifiedAt:observedAt,manualWatch:followed,reviewed:false,pinned:false,archived:false,below:null,lastCapAt:null,label:'',updatedAt:observedAt});
  store.saveSecurity({...pendingSecurity(mint),status:'passed',program:TOKEN_2022,decimals:6,supplyRaw:'950000000000000',checkedAt:observedAt});
}

test('formed-base supply checks do not spend history calls on unqualified background coins',async t=>{
  t.mock.method(Date,'now',()=>epoch);
  const store=new Store(':memory:');t.after(()=>store.close());
  addCandidate(store,'OldBackground',epoch-90_000);
  for(const mint of ['BaseA','BaseB','BaseC']) {
    addCandidate(store,mint,epoch-1000);
    const p=store.pool(`Pool-${mint}`)!;
    store.set(`base:${p.address}`,{...assessBase(p,[],[],epoch),status:'qualified',candleEnd:epoch-60_000});
  }
  const collector=new Collector(store),served:string[]=[];
  t.mock.method(collector as any,'rpc',async(method:string,[mint]:any[])=>{
    assert.equal(method,'getSignaturesForAddress');served.push(mint);
    return Array.from({length:1000},(_,i)=>({signature:`${mint}-${i}`,err:null}));
  });
  await (collector as any).supplyOrigins();await (collector as any).supplyOrigins();await (collector as any).supplyOrigins();
  assert.deepEqual(served,['BaseA','BaseB','BaseC']);
});

test('supply history gives older pending work a turn despite continuous newer discoveries',async t=>{
  let now=epoch;t.mock.method(Date,'now',()=>now);
  const store=new Store(':memory:');t.after(()=>store.close());
  addCandidate(store,'Older',now-90_000,true);addCandidate(store,'Newer',now-10_000,true);
  store.set('supplySearch:Older',{pages:1,before:'previous-page',probes:[],exhausted:false,nextAt:now-60_000,issue:'Pending',parserVersion:SUPPLY_PARSER_VERSION});
  const collector=new Collector(store), served:string[]=[];
  t.mock.method(collector as any,'rpc',async(method:string,[mint,options]:any[])=>{
    assert.equal(method,'getSignaturesForAddress');assert.equal(options.commitment,'finalized');served.push(mint);
    return Array.from({length:1000},(_,i)=>({signature:`${mint}-${served.length}-${i}`,err:null}));
  });
  await (collector as any).supplyOrigins();assert.deepEqual(served,['Older']);
  await (collector as any).supplyOrigins();assert.deepEqual(served,['Older','Newer']);
  now+=40_000;addCandidate(store,'Latest',now-1000,true);
  await (collector as any).supplyOrigins();await (collector as any).supplyOrigins();
  assert.deepEqual(served.slice(2).sort(),['Newer','Older']);
  await (collector as any).supplyOrigins();assert.equal(served.at(-1),'Latest');
});

test('a parser upgrade retries exhausted creation history without rescanning and saves audited real-proof-shaped issuance',async t=>{
  t.mock.method(Date,'now',()=>epoch);
  const store=new Store(':memory:');t.after(()=>store.close());addCandidate(store,'Mint',epoch-1000,true);
  store.set('supplySearch:Mint',{pages:7,before:'creation',probes:[],exhausted:true,nextAt:epoch-500,issue:'No complete proof found'});
  const collector=new Collector(store), requests:string[]=[];
  const ix=(type:string,info:object)=>({programId:TOKEN_2022,parsed:{type,info}});
  t.mock.method(collector as any,'rpc',async(method:string,[signature,options]:any[])=>{
    requests.push(method);assert.equal(method,'getTransaction');assert.equal(signature,'creation');assert.equal(options.commitment,'finalized');
    return {slot:42,meta:{err:null,innerInstructions:[{index:0,instructions:[
      ix('initializeTransferFeeConfig',{mint:'Mint',transferFeeBasisPoints:300}),
      ix('initializeMint2',{mint:'Mint',decimals:6}),ix('mintTo',{mint:'Mint',amount:'1000000000000000'}),
      ix('setAuthority',{mint:'Mint',authorityType:'mintTokens',newAuthority:null}),
    ]}]},transaction:{signatures:[signature],message:{instructions:[{programId:'fixture-launch-program'}]}}};
  });
  await (collector as any).supplyOrigins();
  assert.equal(store.supply('Mint',epoch).status,'passed');assert.equal(store.supplyOrigin('Mint')?.signature,'creation');
  assert.ok(store.activity('supply','Mint').events.some(e=>e.summary==='Initial token issuance verified'));
  assert.equal(store.get<any>('supplySearch:Mint',null).pages,7);
  assert.equal(store.get<any>('supplySearch:Mint',null).parserVersion,SUPPLY_PARSER_VERSION);
  await (collector as any).supplyOrigins();assert.deepEqual(requests,['getTransaction']);
});

test('unsuccessful creation retries are logged once and explicit proof requests keep priority',async t=>{
  t.mock.method(Date,'now',()=>epoch);
  const store=new Store(':memory:');t.after(()=>store.close());
  addCandidate(store,'Older',epoch-90_000,true);addCandidate(store,'Manual',epoch-1000);
  const signature='a'.repeat(64), collector=new Collector(store), requested:string[]=[];
  collector.queueSupplyProof('Pool-Manual',signature);
  store.set('supplySearch:Older',{pages:20,before:'oldest-retrieved',probes:[],exhausted:true,nextAt:epoch-80_000,issue:'Pending'});
  t.mock.method(collector as any,'rpc',async(method:string,[sig]:any[])=>{
    assert.equal(method,'getTransaction');requested.push(sig);
    return {slot:42,meta:{err:null,innerInstructions:[]},transaction:{signatures:[sig],message:{instructions:[]}}};
  });
  await (collector as any).supplyOrigins();assert.deepEqual(requested,[signature]);
  await (collector as any).supplyOrigins();assert.deepEqual(requested,[signature,'oldest-retrieved']);
  assert.equal(store.supply('Older',epoch).status,'pending');assert.match(store.supply('Older',epoch).reasons[0],/20,000-signature search limit/);
  assert.ok(store.activity('supply','Older').events.some(e=>(e.data as any)?.signature==='oldest-retrieved'));
  await (collector as any).supplyOrigins();assert.equal(requested.length,2);
});
