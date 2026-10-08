import { address, getAddressEncoder, getProgramDerivedAddress } from '@solana/addresses';
import type { LaunchOrigin, SupplyOrigin, TokenSecurity } from '../shared/types.ts';
import { base58, PUMP_AMM } from './liquidity.ts';
import { TOKEN, TOKEN_2022 } from './security.ts';
import { SOL } from './providers.ts';

// Verified against the platforms' public IDLs and StonkFun's pricing API.
// See docs/api-allocation.md for sources and the distinction between origin and LP protection.
export const LAUNCH_ORIGIN_VERSION='launch-accounts-v1';
export const PUMP_PROGRAM='6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
export const LAUNCHLAB_PROGRAM='LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj';
export const STONK_PLATFORMS=new Set(['4E876qZTE9FJMrBzgVtBrSrzz2TLivB5Y5QXPjB4gZL7','6BwHHDg3u1854jC8PDLXvR4spTcLNaoBxLJNGC4nTESt']);
const key=(value:string)=>getAddressEncoder().encode(address(value));
const pda=async(program:string,seeds:Parameters<typeof getProgramDerivedAddress>[0]['seeds'])=>(await getProgramDerivedAddress({programAddress:address(program),seeds}))[0];
export async function launchAddresses(mint:string,quoteMint:string) {
  const authority=await pda(PUMP_PROGRAM,['pool-authority',key(mint)]);
  return {pump:await pda(PUMP_PROGRAM,['bonding-curve',key(mint)]),
    pumpDestination:await pda(PUMP_AMM,['pool',new Uint8Array([0,0]),key(authority),key(mint),key(quoteMint)]),
    ray:await pda(LAUNCHLAB_PROGRAM,['pool',key(mint),key(quoteMint)]),authority};
}
function bytes(account:any,owner:string,discriminator:number[],minimum:number):Buffer|null {
  if(account?.owner!==owner||account.executable!==false||!Array.isArray(account.data)||account.data[1]!=='base64'||typeof account.data[0]!=='string')return null;
  const b=Buffer.from(account.data[0],'base64');
  return b.length>=minimum&&b.subarray(0,8).equals(Buffer.from(discriminator))?b:null;
}
function controlsMatch(controls:TokenSecurity,mint:string,slot:number) {
  return controls.mint===mint&&[TOKEN,TOKEN_2022].includes(controls.program??'')&&Number.isSafeInteger(slot)&&slot>0
    &&Number.isInteger(controls.decimals)&&controls.decimals!==null&&controls.decimals!==undefined;
}
export async function parsePumpOrigin(mint:string,curveAddress:string,account:any,destination:any,controls:TokenSecurity,slot:number,now:number):Promise<LaunchOrigin|null> {
  if(!controlsMatch(controls,mint,slot)||controls.decimals!==6)return null;
  const b=bytes(account,PUMP_PROGRAM,[23,183,248,55,96,216,172,96],49);
  if(!b||b[48]>1||(b.length>81&&b[81]>1))return null;
  const quoteMint=b.length>=115&&base58(b.subarray(83,115))!=='11111111111111111111111111111111'?base58(b.subarray(83,115)):SOL;
  const addresses=await launchAddresses(mint,quoteMint);
  if(curveAddress!==addresses.pump)return null;
  const raw=b.readBigUInt64LE(40);if(raw===0n)return null;
  const mayhem=b.length>81&&b[81]===1;
  const d=bytes(destination,PUMP_AMM,[241,154,109,4,17,177,109,188],211);
  const migrated=b[48]===1&&b.readBigUInt64LE(24)===0n&&destination?.address===addresses.pumpDestination&&d!==null
    &&d.readUInt16LE(9)===0&&base58(d.subarray(11,43))===addresses.authority
    &&base58(d.subarray(43,75))===mint&&base58(d.subarray(75,107))===quoteMint;
  return {mint,platform:'Pump.fun',program:PUMP_PROGRAM,account:curveAddress,quoteMint,initialRaw:mayhem?null:raw.toString(),decimals:6,
    graduated:migrated,destinationPool:migrated?addresses.pumpDestination:null,checkedAt:now,slot,version:LAUNCH_ORIGIN_VERSION,
    source:'Finalized Pump.fun bonding-curve account and canonical migration pool',
    ...(mayhem?{notice:'Mayhem launch identified; starting issuance requires separate evidence'}:{})};
}
export async function parseLaunchLabOrigin(mint:string,quoteMint:string,curveAddress:string,account:any,controls:TokenSecurity,slot:number,now:number):Promise<LaunchOrigin|null> {
  if(!controlsMatch(controls,mint,slot))return null;
  const b=bytes(account,LAUNCHLAB_PROGRAM,[247,237,227,245,215,195,222,70],429);
  if(!b||b[17]>2||b[20]>1||b[18]!==controls.decimals||b[365]>3
    ||((b[365]&1)===1?TOKEN_2022:TOKEN)!==controls.program)return null;
  if(base58(b.subarray(205,237))!==mint||base58(b.subarray(237,269))!==quoteMint)return null;
  if(curveAddress!==(await launchAddresses(mint,quoteMint)).ray)return null;
  const raw=b.readBigUInt64LE(21);if(raw===0n)return null;
  const platformConfig=base58(b.subarray(173,205));
  return {mint,platform:STONK_PLATFORMS.has(platformConfig)?'StonkFun':'Raydium LaunchLab',program:LAUNCHLAB_PROGRAM,account:curveAddress,
    quoteMint,platformConfig,initialRaw:raw.toString(),decimals:controls.decimals!,graduated:b[17]===2,destinationPool:null,checkedAt:now,slot,
    version:LAUNCH_ORIGIN_VERSION,source:'Finalized Raydium LaunchLab pool state, mint identity and platform configuration',
    notice:'Graduation belongs to this token’s launch. Protection is checked separately for the selected trading pool.'};
}
export function launchSupply(origin:LaunchOrigin):SupplyOrigin|null {
  if(origin.initialRaw===null)return null;
  return {mint:origin.mint,raw:origin.initialRaw,decimals:origin.decimals,account:origin.account,program:origin.program,platform:origin.platform,
    slot:origin.slot,checkedAt:origin.checkedAt,source:`${origin.platform} launch-account supply`};
}
