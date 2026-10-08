import type { SupplyAssessment, SupplyOrigin, TokenSecurity } from '../shared/types.ts';
import { fresh, RISK_POLICY, TOKEN, TOKEN_2022 } from './security.ts';

export const SUPPLY_POLICY = 'initial-1b-current-at-most-1b-v1';
export const SUPPLY_PARSER_VERSION = 2;
// Parsed v1 messages retain the instruction fields used by this verifier.
export const MAX_TRANSACTION_VERSION = 1;
const rawValid = (raw: unknown): raw is string => typeof raw==='string' && /^\d{1,20}$/.test(raw) && BigInt(raw)<=18446744073709551615n;
export function assessSupply(controls: TokenSecurity, origin: SupplyOrigin | null, now: number, historyIssue?: string): SupplyAssessment {
  const result: SupplyAssessment = { status: 'pending', reasons: [], currentRaw: controls.supplyRaw ?? null, decimals: controls.decimals ?? null, origin };
  const finish=(status:SupplyAssessment['status'],reason:string)=>({...result,status,reasons:[reason]});
  if (!rawValid(result.currentRaw) || result.decimals===null || !Number.isInteger(result.decimals) || result.decimals<0 || result.decimals>255
    || !fresh(controls.checkedAt,now,RISK_POLICY.controlsMaxAge)) return finish('pending','Current on-chain total supply needs verification');
  const target=1_000_000_000n*10n**BigInt(result.decimals), current=BigInt(result.currentRaw);
  if(current>target)return finish('excluded','Current total supply exceeds 1 billion tokens');
  if(current===0n)return finish('excluded','Current token supply is zero');
  if(!origin)return finish('pending',historyIssue || 'Starting supply of exactly 1 billion tokens is not yet verified');
  if(origin.mint!==controls.mint || origin.decimals!==result.decimals || !rawValid(origin.raw))return finish('pending','Starting-supply evidence does not match this mint and its decimals');
  if(BigInt(origin.raw)!==target)return finish('excluded','Verified initial issuance was not 1 billion tokens');
  return finish('passed',current<target?'Started at 1 billion tokens; current supply is lower. Burned-down supply is allowed.':'Started at 1 billion tokens; current supply remains 1 billion');
}

// Transaction fallback; verified program-owned launch accounts are handled by launch-origin.ts.
// An arbitrary old balance, current 1B supply, FDV, name or venue is not proof.
export function parseSupplyOrigin(mint: string, signature: string, tx: any, controls: TokenSecurity, now: number): SupplyOrigin | null {
  if(tx?.version!==undefined&&tx.version!=='legacy'&&tx.version!==0&&tx.version!==1)return null;
  if(tx?.meta?.err!==null || !Number.isSafeInteger(tx.slot) || !tx.transaction?.signatures?.includes(signature)
    || !Array.isArray(tx.transaction?.message?.instructions) || !Array.isArray(tx.meta.innerInstructions)
    || controls.mint!==mint || !Number.isInteger(controls.decimals) || controls.decimals===null || controls.decimals===undefined
    || controls.decimals<0 || controls.decimals>255 || ![TOKEN,TOKEN_2022].includes(controls.program??''))return null;
  const instructions=tx.transaction.message.instructions.flatMap((outer:any,index:number)=>[outer,...tx.meta.innerInstructions.filter((g:any)=>g.index===index).flatMap((g:any)=>g.instructions??[])]);
  const canonical=instructions.filter((i:any)=>i.programId===controls.program);
  if(canonical.some((i:any)=>!i.parsed))return null;
  const relevant=canonical.filter((i:any)=>i.parsed.info?.mint===mint||(i.parsed.type==='setAuthority'&&i.parsed.info?.account===mint)).map((i:any)=>i.parsed);
  const initializations=relevant.filter((i:any)=>['initializeMint','initializeMint2'].includes(i.type));
  if(initializations.length!==1 || initializations[0].info.decimals!==controls.decimals)return null;
  // Token-2022 metadata pointers and transfer-fee configuration precede mint initialization.
  // Allow that setup, but issuance itself must follow initialization of this exact mint.
  let issued=0n, initialized=false;
  for(const instruction of relevant) {
    if(instruction===initializations[0])initialized=true;
    if(!['mintTo','mintToChecked'].includes(instruction.type))continue;
    if(!initialized)return null;
    const amount=instruction.info.amount??instruction.info.tokenAmount?.amount;
    if(!rawValid(amount))return null;
    if(instruction.type==='mintToChecked'&&instruction.info.tokenAmount?.decimals!==controls.decimals)return null;
    issued+=BigInt(amount);
  }
  // Separate creation and issuance transactions need additional evidence; never infer a zero initial supply.
  if(issued===0n || issued>18446744073709551615n)return null;
  // A smaller mint in an open issuance transaction may be only the first installment.
  const revoked=relevant.some((i:any)=>i.type==='setAuthority'&&i.info.authorityType==='mintTokens'&&i.info.newAuthority===null);
  const target=1_000_000_000n*10n**BigInt(controls.decimals);
  if(issued<target&&!revoked)return null;
  return { mint, raw: issued.toString(), decimals: controls.decimals, signature, slot: tx.slot, checkedAt: now, source: 'Finalized mint initialization and issuance transaction' };
}
