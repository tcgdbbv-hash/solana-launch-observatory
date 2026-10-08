import { createHash } from 'node:crypto';
import type { LiquidityProtection, Pool } from '../shared/types.ts';
import { fresh, RISK_POLICY, TOKEN, TOKEN_2022 } from './security.ts';
import { LIQUIDITY_POLICY, knownLowLiquidity } from '../shared/liquidity.ts';
export { LIQUIDITY_POLICY, knownLowLiquidity } from '../shared/liquidity.ts';
export const PUMP_AMM='pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';
export const RAY_CPMM='CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C';
export const RAY_AUTH='GpMZbSM2GgvTKHJirzeGfMFoaZ8UR2X7F4v8vHTvxFbL';
export const RAY_LOCK_AUTH='3f7GcQFG397GAaEnv51zR6tsTVihYRydnydDD1cXekxH';
export function hardLiquidity(pool:Pool,now:number) {
  if(knownLowLiquidity(pool,now))return {status:'excluded' as const,reasons:['Pool liquidity is below the mandatory $1,000 USD-equivalent floor; disregarded']};
  if(!fresh(pool.metricsAt,now,RISK_POLICY.metricsMaxAge)||pool.liquidity===null||!Number.isFinite(pool.liquidity)||pool.liquidity<0)
    return {status:'pending' as const,reasons:['Recent pool liquidity is required for the mandatory $1,000 floor']};
  return {status:'passed' as const,reasons:[] as string[]};
}
export const pendingProtection=(pool:Pool,reason='Pool-specific liquidity lock/burn evidence is not yet verified'):LiquidityProtection=>({pool:pool.address,mint:pool.mint,status:'pending',checkedAt:null,slot:null,lpMint:null,burnedPercent:null,lockedPercent:null,totalLpRaw:null,liveLpRaw:null,lockedLpRaw:null,reasons:[reason],source:'Finalized Solana RPC',policyVersion:LIQUIDITY_POLICY.version});
const alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function base58(bytes:Uint8Array):string {
  let n=BigInt('0x'+Buffer.from(bytes).toString('hex')), out='';
  while(n){out=alphabet[Number(n%58n)]+out;n/=58n;}
  for(const b of bytes){if(b!==0)break;out='1'+out;}return out;
}
export interface DecodedPool { program:string; lpMint:string; totalLpRaw:string; mintAuthority:string; lpTokenProgram:string; }
export function decodeLiquidityPool(pool:Pool,account:any):DecodedPool|null {
  if(account?.executable!==false||!Array.isArray(account.data)||account.data[1]!=='base64')return null;
  const bytes=Buffer.from(account.data[0],'base64'), pump=account.owner===PUMP_AMM&&pool.venue==='PumpSwap', ray=account.owner===RAY_CPMM&&pool.venue==='Raydium';
  if(!pump&&!ray)return null;
  const discriminator=pump?Buffer.from([241,154,109,4,17,177,109,188]):createHash('sha256').update('account:PoolState').digest().subarray(0,8);
  if(bytes.length<(pump?211:341)||!bytes.subarray(0,8).equals(discriminator))return null;
  const readKey=(offset:number)=>base58(bytes.subarray(offset,offset+32));
  const mintA=readKey(pump?43:168), mintB=readKey(pump?75:200);
  if(!((mintA===pool.mint&&mintB===pool.quoteMint)||(mintB===pool.mint&&mintA===pool.quoteMint)))return null;
  return {program:account.owner,lpMint:readKey(pump?107:136),totalLpRaw:bytes.readBigUInt64LE(pump?203:333).toString(),mintAuthority:pump?pool.address:RAY_AUTH,lpTokenProgram:pump?TOKEN_2022:TOKEN};
}
export function assessProtection(pool:Pool,decoded:DecodedPool,lpAccount:any,lockAccounts:any[],slot:number,now:number):LiquidityProtection {
  const evidence={...pendingProtection(pool),checkedAt:now,slot,lpMint:decoded.lpMint,totalLpRaw:decoded.totalLpRaw,lpTokenProgram:lpAccount?.owner??null};
  const info=lpAccount?.data?.parsed?.info;
  // PumpSwap LP mints use Token-2022 even when the coin uses the legacy token
  // program. Raydium CPMM LP mints use legacy SPL Token. Validate the LP itself.
  if(lpAccount?.owner!==decoded.lpTokenProgram||lpAccount.executable!==false||lpAccount.data?.parsed?.type!=='mint'||info?.isInitialized!==true
    || info.freezeAuthority!==null||info.mintAuthority!==decoded.mintAuthority||typeof info.supply!=='string'||!/^\d{1,20}$/.test(info.supply))
    return {...evidence,reasons:['LP mint ownership, supply or authority could not be verified']};
  // Both supported protocols currently issue plain 82-byte LP mints. Never
  // silently accept an unknown extension that could change LP withdrawal rights.
  if((lpAccount.space??lpAccount.data.space)!==82 || (info.extensions!==undefined&&(!Array.isArray(info.extensions)||info.extensions.length>0)))
    return {...evidence,reasons:['Unexpected LP mint size or extensions; withdrawal rights need an updated adapter']};
  const total=BigInt(decoded.totalLpRaw), live=BigInt(info.supply);
  if(total<=0n||live>total)return {...evidence,reasons:['Inconsistent pool and LP supply; protection remains unverified']};
  let locked=0n;
  if(decoded.program===RAY_CPMM)for(const account of lockAccounts){
    const a=account?.data?.parsed?.info;
    if(account?.owner===TOKEN&&account.executable===false&&account.data?.parsed?.type==='account'&&a?.owner===RAY_LOCK_AUTH&&a.mint===decoded.lpMint&&a.state==='initialized'
      &&!a.delegate&&typeof a.tokenAmount?.amount==='string'&&/^\d{1,20}$/.test(a.tokenAmount.amount))locked+=BigInt(a.tokenAmount.amount);
  }
  if(locked>live)return {...evidence,reasons:['LP lock balance exceeds circulating LP supply; recheck required']};
  const burned=total-live, percent=(amount:bigint)=>Number(amount*1_000_000n/total)/10_000, protectedAll=burned+locked===total;
  return {...evidence,status:protectedAll?'passed':'pending',liveLpRaw:live.toString(),lockedLpRaw:locked.toString(),burnedPercent:percent(burned),lockedPercent:percent(locked),
    reasons:[protectedAll?live===0n?'LP protected: all recorded LP rights are burned/non-redeemable':'LP protected: all recorded LP rights are burned/non-redeemable or held by the recognized Raydium permanent lock authority':`Only ${percent(burned+locked)}% of LP rights have verified protection; the remainder may be withdrawable or use an unverified locker`,
      'Pool-specific observation; new deposits and shared-program changes can alter protection. LP protection does not prevent price collapse.']};
}
