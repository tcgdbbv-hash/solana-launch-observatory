import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { assessSupply, parseSupplyOrigin } from '../server/supply.ts';
import { pendingSecurity, TOKEN, TOKEN_2022 } from '../server/security.ts';
import { hardLiquidity, pendingProtection, base58, decodeLiquidityPool, assessProtection, PUMP_AMM, RAY_CPMM, RAY_AUTH, RAY_LOCK_AUTH } from '../server/liquidity.ts';
import { blankPool } from '../server/providers.ts';
import { Store } from '../server/store.ts';
const now=1_790_520_000_000, mint='Mint', sig='creation-fixture';
const controls={...pendingSecurity(mint),status:'passed' as const,program:TOKEN,supplyRaw:'1000000000000000',decimals:6,checkedAt:now};
const ix=(type:string,info:object)=>({programId:TOKEN,parsed:{type,info}});
const tx=(amount='1000000000000000')=>({slot:42,meta:{err:null,innerInstructions:[{index:0,instructions:[ix('initializeMint2',{mint,decimals:6}),ix('mintTo',{mint,amount}),ix('setAuthority',{account:mint,authorityType:'mintTokens',newAuthority:null})]}]},transaction:{signatures:[sig],message:{instructions:[{programId:'launch-program'}]}}});
test('parsed v1 issuance is supported, while unknown versions and missing instructions are not proof',()=>{
  const v1={...tx(),version:1};
  Object.assign(v1.transaction.message,{transactionConfig:{computeUnitLimit:30000,heapSize:null,loadedAccountsDataSizeLimit:null,priorityFee:null}});
  assert.equal(parseSupplyOrigin(mint,sig,v1,controls,now)?.raw,'1000000000000000');
  for(const version of [2,-1,'1',null])assert.equal(parseSupplyOrigin(mint,sig,{...v1,version},controls,now),null);
  v1.meta.innerInstructions=[];
  assert.equal(parseSupplyOrigin(mint,sig,v1,controls,now),null);
});
test('supply requires original 1B issuance; burns allowed but current 1B alone is not proof',()=>{
  const origin=parseSupplyOrigin(mint,sig,tx(),controls,now);assert.ok(origin);
  assert.equal(assessSupply(controls,origin,now).status,'passed');
  assert.equal(assessSupply({...controls,supplyRaw:'900000000000000'},origin,now).status,'passed');
  assert.equal(assessSupply({...controls,supplyRaw:'1000000000000001'},origin,now).status,'excluded');
  assert.equal(assessSupply(controls,null,now).status,'pending');
  const other=parseSupplyOrigin(mint,sig,tx('2000000000000000'),controls,now)!;
  assert.equal(assessSupply(controls,other,now).status,'excluded');
  assert.equal(assessSupply(controls,{...origin,decimals:9},now).status,'pending');
  assert.equal(assessSupply({...controls,checkedAt:now-86400_001},origin,now).status,'pending');
});
test('supply parser rejects wrong mint, failed/partial history, unparsed issuance and missing creation',()=>{
  assert.equal(parseSupplyOrigin('Other',sig,tx(),controls,now),null);
  const failed=tx();failed.meta.err={} as any;assert.equal(parseSupplyOrigin(mint,sig,failed,controls,now),null);
  const missing=tx();missing.meta.innerInstructions[0].instructions.shift();assert.equal(parseSupplyOrigin(mint,sig,missing,controls,now),null);
  const incomplete=tx();incomplete.meta.innerInstructions=null as any;assert.equal(parseSupplyOrigin(mint,sig,incomplete,controls,now),null);
  const wrong=tx();wrong.meta.innerInstructions[0].instructions.forEach(i=>i.programId=TOKEN_2022);assert.equal(parseSupplyOrigin(mint,sig,wrong,controls,now),null);
  const zero=tx('0');assert.equal(parseSupplyOrigin(mint,sig,zero,controls,now),null);
});
test('Token-2022 extension setup before mint initialization does not hide the initial billion-token issuance',()=>{
  const creation=tx(), instructions=creation.meta.innerInstructions[0].instructions;
  instructions.unshift(ix('initializeMetadataPointer',{mint,metadataAddress:mint}),ix('initializeTransferFeeConfig',{mint,transferFeeBasisPoints:300}));
  instructions[4]=ix('setAuthority',{mint,authorityType:'mintTokens',newAuthority:null});
  instructions.push(ix('mintTo',{mint:'UnrelatedQuoteMint',amount:'9000000000000000'}));
  instructions.forEach(i=>i.programId=TOKEN_2022);
  const token2022={...controls,program:TOKEN_2022};
  const origin=parseSupplyOrigin(mint,sig,creation,token2022,now);
  assert.equal(origin?.raw,'1000000000000000');assert.equal(assessSupply(token2022,origin,now).status,'passed');
  assert.equal(parseSupplyOrigin(mint,'wrong-signature',creation,token2022,now),null);
  assert.equal(parseSupplyOrigin(mint,sig,creation,{...token2022,decimals:9},now),null);
  const outOfOrder=structuredClone(creation), wrongOrder=outOfOrder.meta.innerInstructions[0].instructions;
  [wrongOrder[2],wrongOrder[3]]=[wrongOrder[3],wrongOrder[2]];
  assert.equal(parseSupplyOrigin(mint,sig,outOfOrder,token2022,now),null);
  const unparsed=structuredClone(creation);unparsed.meta.innerInstructions[0].instructions.push({programId:TOKEN_2022,data:'unknown'} as any);
  assert.equal(parseSupplyOrigin(mint,sig,unparsed,token2022,now),null);
  const duplicate=structuredClone(creation);duplicate.meta.innerInstructions[0].instructions.push(instructions[2]);
  assert.equal(parseSupplyOrigin(mint,sig,duplicate,token2022,now),null);
});
test('hard liquidity floor includes zero and cannot be bypassed by manual inclusion',()=>{
  const store=new Store(':memory:'),p={...blankPool('Pool',mint,'Raydium',now),metricsAt:now,liquidity:999.99};store.discover(p);
  const c={mint,pool:p.address,qualifiedAt:now,reviewed:false,pinned:true,archived:false,below:false,lastCapAt:now,label:'',updatedAt:now};store.saveCandidate(c);
  store.saveSecurity(controls);store.saveSupplyOrigin(parseSupplyOrigin(mint,sig,tx(),controls,now)!);
  store.saveProtection({...pendingProtection(p),status:'passed',checkedAt:now});store.manualRiskReview(mint,true,'Fixture manual review',now);
  assert.equal(store.group(c,now),'excluded');
  assert.equal(hardLiquidity({...p,liquidity:0},now).status,'excluded');assert.equal(hardLiquidity({...p,liquidity:1000},now).status,'passed');
  assert.equal(hardLiquidity({...p,liquidity:20_000,metricsAt:now-120001},now).status,'pending');
  assert.equal(hardLiquidity({...p,liquidity:null},now).status,'pending');store.close();
});
test('LP decoders verify owner, layout and both pool mints before calculating burned/locked rights',()=>{
  for(const kind of ['PumpSwap','Raydium'] as const){
    const pump=kind==='PumpSwap',m1=Buffer.alloc(32,3),m2=Buffer.alloc(32,4),lp=Buffer.alloc(32,5);
    const p={...blankPool('Pool',base58(m1),kind,now),quoteMint:base58(m2)};
    const bytes=Buffer.alloc(pump?211:341);(pump?Buffer.from([241,154,109,4,17,177,109,188]):createHash('sha256').update('account:PoolState').digest().subarray(0,8)).copy(bytes);
    m1.copy(bytes,pump?43:168);m2.copy(bytes,pump?75:200);lp.copy(bytes,pump?107:136);bytes.writeBigUInt64LE(1000n,pump?203:333);
    const account={owner:pump?PUMP_AMM:RAY_CPMM,executable:false,data:[bytes.toString('base64'),'base64']};
    const decoded=decodeLiquidityPool(p,account)!;assert.equal(decoded.lpMint,base58(lp));assert.equal(decoded.totalLpRaw,'1000');
    assert.equal(decodeLiquidityPool({...p,mint:'Wrong'},account),null);assert.equal(decodeLiquidityPool(p,{...account,owner:'Wrong'}),null);
    const lpAccount={owner:pump?TOKEN_2022:TOKEN,executable:false,space:82,data:{parsed:{type:'mint',info:{isInitialized:true,freezeAuthority:null,mintAuthority:pump?p.address:RAY_AUTH,supply:'0'}}}};
    assert.equal(decoded.lpTokenProgram,pump?TOKEN_2022:TOKEN);
    assert.equal(assessProtection(p,decoded,lpAccount,[],42,now).burnedPercent,100);assert.equal(assessProtection(p,decoded,lpAccount,[],42,now).status,'passed');
    assert.equal(assessProtection(p,decoded,{...lpAccount,owner:pump?TOKEN:TOKEN_2022},[],42,now).status,'pending');
    assert.equal(assessProtection(p,decoded,{...lpAccount,space:200},[],42,now).status,'pending');
    const changed=structuredClone(lpAccount);(changed.data.parsed.info as any).extensions=[{extension:'permanentDelegate',state:{delegate:'Unapproved'}}];
    assert.equal(assessProtection(p,decoded,changed,[],42,now).status,'pending');
    lpAccount.data.parsed.info.supply='400';
    const partial=assessProtection(p,decoded,lpAccount,[],42,now);assert.equal(partial.status,'pending');assert.equal(partial.burnedPercent,60);
    if(!pump){
      const locked={owner:TOKEN,executable:false,data:{parsed:{type:'account',info:{owner:RAY_LOCK_AUTH,mint:decoded.lpMint,state:'initialized',tokenAmount:{amount:'400'}}}}};
      const passed=assessProtection(p,decoded,lpAccount,[locked],42,now);assert.equal(passed.status,'passed');assert.equal(passed.lockedPercent,40);
      (locked.data.parsed.info as any).delegate='Withdrawer';assert.equal(assessProtection(p,decoded,lpAccount,[locked],42,now).status,'pending');
    }
    lpAccount.data.parsed.info.supply='1001';assert.equal(assessProtection(p,decoded,lpAccount,[],42,now).status,'pending');
  }
});
