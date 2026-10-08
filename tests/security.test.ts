import test from 'node:test';
import assert from 'node:assert/strict';
import { approveScopeChecks } from './scope-fixtures.ts';
import { Store } from '../server/store.ts';
import { blankPool } from '../server/providers.ts';
import { assessMint, assessProgram, assessTrading, combineRisk, parseQuote, pendingTrading, pendingSecurity,
  RISK_POLICY, TOKEN, TOKEN_2022, UPGRADEABLE_LOADER, USDC, type ProgramEvidence } from '../server/security.ts';
const now=1_790_520_000_000;
const mint='MintFixture';
const pool={...blankPool('PoolFixture',mint,'Raydium',now),liquidity:20_000,metricsAt:now};
const immutable:ProgramEvidence={address:TOKEN,immutable:true,programData:'ProgramDataFixture',checkedAt:now,reason:'Revoked'};
const account=(info:Record<string,unknown>={},owner=TOKEN)=>({owner,executable:false,space:82,data:{parsed:{type:'mint',info:{isInitialized:true,supply:'1000000000000000',decimals:6,mintAuthority:null,freezeAuthority:null,...info}}}});
function quote(inputMint=USDC,outputMint=mint,inAmount:string=RISK_POLICY.sampleUsdcRaw,outAmount='123456789',priceImpact=.1){
  return parseQuote({inputMint,outputMint,inAmount,outAmount,swapMode:'ExactIn',priceImpact,routePlan:[{swapInfo:{ammKey:pool.address}}]},inputMint,outputMint,inAmount,now);
}
const buy=quote(),sell=quote(mint,USDC,buy.outAmount,'24900000');
test('mint and freeze revocation are required; canonical shared upgradeability is disclosed',()=>{
  assert.equal(assessMint(mint,account(),immutable,now,1).status,'passed');
  for (const field of ['mintAuthority','freezeAuthority']) {
    assert.equal(assessMint(mint,account({[field]:'ActiveAuthority'}),immutable,now,1).status,'excluded');
    assert.equal(assessMint(mint,account({[field]:undefined}),immutable,now,1).status,'pending');
  }
  const shared=assessMint(mint,account(),{...immutable,immutable:false,reason:'Upgradeable'},now,1);
  assert.equal(shared.status,'passed');assert.ok(shared.notices.some(n=>n.includes('upgradeable')));
  assert.equal(assessMint(mint,account(),null,now,1).status,'pending');
  assert.equal(assessMint(mint,account(),{...immutable,checkedAt:now+1},now,1).status,'pending');
  assert.equal(assessMint(mint,account({},'CustomProgram'),immutable,now,1).status,'excluded');
});
test('only explicit verified loader authority null establishes program immutability',()=>{
  const program={owner:UPGRADEABLE_LOADER,executable:true,data:{parsed:{type:'program',info:{programData:'ProgramDataFixture'}}}};
  const data={owner:UPGRADEABLE_LOADER,executable:false,data:{parsed:{type:'programData',info:{authority:null}}}};
  assert.equal(assessProgram(TOKEN,program,data,now).immutable,true);
  assert.equal(assessProgram(TOKEN,program,{...data,data:{parsed:{type:'programData',info:{authority:'Active'}}}},now).immutable,false);
  assert.equal(assessProgram(TOKEN,program,{...data,data:{parsed:{type:'programData',info:{}}}},now).immutable,null);
  assert.equal(assessProgram(TOKEN,{...program,owner:'UnknownLoader'},data,now).immutable,null);
});
test('Token-2022 metadata may change but freezing, hooks, delegates and unknown extensions fail closed',()=>{
  const program={...immutable,address:TOKEN_2022};
  for(const extension of ['defaultAccountState','transferHook','permanentDelegate','pausable','unknown'])
    assert.equal(assessMint(mint,account({extensions:[{extension}]},TOKEN_2022),program,now,1).status,'excluded');
  assert.equal(assessMint(mint,account({extensions:[{extension:'metadataPointer'},{extension:'tokenMetadata'}]},TOKEN_2022),program,now,1).status,'passed');
  assert.equal(assessMint(mint,account({},TOKEN_2022),program,now,1).status,'pending');
  assert.equal(assessMint(mint,account({extensions:[]},TOKEN_2022),{...program,immutable:false},now,1).status,'passed');
});
test('quotes require exact mints, amounts, routing and unambiguous percentage units',()=>{
  const raw={inputMint:USDC,outputMint:mint,inAmount:RISK_POLICY.sampleUsdcRaw,outAmount:'90071992547409930',swapMode:'ExactIn',priceImpact:.2,routePlan:[{swapInfo:{ammKey:pool.address}}]};
  assert.equal(parseQuote(raw,USDC,mint,RISK_POLICY.sampleUsdcRaw,now).outAmount,raw.outAmount);
  for(const change of [{outputMint:'wrong'},{inAmount:'1'},{outAmount:'1e9'},{outAmount:'0'},{routePlan:[]},{priceImpact:undefined,priceImpactPct:'0.01'},{priceImpact:NaN},{errorCode:1}])
    assert.throws(()=>parseQuote({...raw,...change},USDC,mint,RISK_POLICY.sampleUsdcRaw,now));
  assert.equal(parseQuote({...raw,priceImpact:-.2},USDC,mint,RISK_POLICY.sampleUsdcRaw,now).priceImpactPercent,.2);
});
test('trading gate checks reverse sell size, liquidity, impact, loss and freshness',()=>{
  assert.equal(assessTrading(pool,buy,sell,now).status,'passed');
  assert.ok(Math.abs(assessTrading(pool,buy,sell,now).roundTripLossPercent!-.4)<.0001);
  assert.equal(assessTrading(pool,buy,{...sell,inAmount:'1'},now).status,'pending');
  assert.equal(assessTrading({...pool,liquidity:9999},buy,sell,now).status,'excluded');
  assert.equal(assessTrading({...pool,liquidity:null},buy,sell,now).status,'pending');
  assert.equal(assessTrading(pool,{...buy,priceImpactPercent:5.01},sell,now).status,'excluded');
  assert.equal(assessTrading(pool,buy,{...sell,outAmount:'22499999'},now).status,'excluded');
  assert.equal(assessTrading(pool,buy,sell,now+RISK_POLICY.quoteMaxAge+1).status,'pending');
});
test('pending checks, expiry, pin, restore and positive reviews cannot bypass the risk gate',()=>{
  const store=new Store(':memory:');store.discover(pool);
  const candidate={mint,pool:pool.address,qualifiedAt:now,reviewed:true,pinned:true,archived:false,below:true,lastCapAt:now,label:'Possible base',updatedAt:now};
  assert.equal(store.group(candidate,now),'pending');
  const controls=assessMint(mint,account(),immutable,now,1),trading=assessTrading(pool,buy,sell,now);
  store.saveSecurity(controls);store.saveTrading(trading);approveScopeChecks(store,pool,now);assert.equal(store.group(candidate,now),'below');
  store.saveSecurity({...controls,status:'excluded',reasons:['Active freeze authority']});assert.equal(store.group(candidate,now),'excluded');
  assert.equal(store.group({...candidate,archived:true},now),'archived');
  store.saveSecurity(controls);assert.equal(store.group(candidate,now+RISK_POLICY.quoteMaxAge+1),'pending');
  assert.equal(combineRisk(pool,controls,{...trading,pool:'WrongPool'},now).status,'pending');
  assert.equal(combineRisk(pool,pendingSecurity(mint),pendingTrading(pool),now).status,'pending');store.close();
});

test('explicitly allowed transfer fees are disclosed rather than rejected, including a retained fee authority',()=>{
  const fee={transferFeeBasisPoints:300,maximumFee:'1000000000000000',epoch:1044};
  const state={olderTransferFee:fee,newerTransferFee:fee,transferFeeConfigAuthority:'FeeAuthorityFixture',withdrawWithheldAuthority:'FeeAuthorityFixture'};
  const result=assessMint(mint,account({extensions:[{extension:'transferFeeConfig',state}]},TOKEN_2022),{...immutable,address:TOKEN_2022},now,1);
  assert.equal(result.status,'passed');assert.equal(result.transferFee?.newerBasisPoints,300);
  assert.ok(result.notices.some(n=>n.includes('can be changed')));
  assert.equal(assessMint(mint,account({extensions:[{extension:'transferFeeConfig'}]},TOKEN_2022),{...immutable,address:TOKEN_2022},now,1).status,'pending');
});

test('explicit manual review can override trading thresholds but never mint/freeze controls or stale verification',()=>{
  const store=new Store(':memory:');store.discover(pool);
  const c={mint,pool:pool.address,qualifiedAt:now,reviewed:false,pinned:false,archived:false,below:true,lastCapAt:now,label:'',updatedAt:now};
  store.saveCandidate(c);
  const controls=assessMint(mint,account(),immutable,now,1);store.saveSecurity(controls);approveScopeChecks(store,pool,now);
  store.saveTrading(assessTrading(pool,{...buy,priceImpactPercent:6},sell,now));assert.equal(store.group(c,now),'excluded');
  store.manualRiskReview(mint,true,'User explicitly accepts the trading-screen warning after manual review',now);
  assert.equal(store.group(store.candidate(mint)!,now),'below');assert.equal(store.risk(pool,now).status,'excluded');
  assert.equal(store.group({...store.candidate(mint)!,below:false},now),'watching');
  const origin=store.supplyOrigin(mint);store.set(`supplyOrigin:${mint}`,null);
  assert.equal(store.group(c,now),'pending');store.set(`supplyOrigin:${mint}`,origin);
  store.saveSecurity({...controls,status:'excluded',reasons:['Freeze authority active']});assert.equal(store.group(c,now),'excluded');
  store.saveSecurity(controls);assert.equal(store.group(c,now+RISK_POLICY.controlsMaxAge+1),'pending');
  store.manualRiskReview(mint,false,'Return to automatic trading checks',now);assert.equal(store.group(c,now),'excluded');store.close();
});
