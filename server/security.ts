import type { Pool, QuoteEvidence, RiskAssessment, TokenSecurity, Tradeability } from '../shared/types.ts';

export const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
export const UPGRADEABLE_LOADER = 'BPFLoaderUpgradeab1e11111111111111111111111';
export const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const RISK_POLICY = {
  version: 'standard-programs-fee-allowed-v3', requireImmutableProgram: false, controlsMaxAge: 86_400_000, quoteMaxAge: 300_000,
  metricsMaxAge: 120_000, sampleUsdcRaw: '25000000', minLiquidityUsd: 10_000,
  maxImpactPercent: 5, maxRoundTripLossPercent: 10,
} as const;
export interface ProgramEvidence {
  address: string; immutable: boolean | null; programData: string | null;
  checkedAt: number; reason: string;
}
export const fresh = (time: number | null, now: number, age: number) =>
  time !== null && Number.isFinite(time) && time <= now && now - time <= age;
export function pendingSecurity(mint: string, reason = 'On-chain token controls have not been verified'): TokenSecurity {
  return { mint, status: 'pending', checkedAt: null, slot: null, program: null, mintAuthority: null,
    freezeAuthority: null, authoritiesVerified: false, programImmutable: null, programData: null,
    extensions: [], reasons: [reason], policyVersion: RISK_POLICY.version, notices: [], transferFee: null, supplyRaw: null, decimals: null };
}
export function pendingTrading(pool: Pool, reason = 'Buy and sell quotes have not been checked'): Tradeability {
  return { mint: pool.mint, pool: pool.address, status: 'pending', checkedAt: null, buy: null, sell: null,
    roundTripLossPercent: null, liquidity: pool.liquidity, liquidityAt: pool.metricsAt,
    reasons: [reason], policyVersion: RISK_POLICY.version };
}
export function assessProgram(address: string, program: any, data: any, now: number): ProgramEvidence {
  const result: ProgramEvidence = { address, immutable: null, programData: null, checkedAt: now, reason: 'Program immutability could not be verified' };
  if (![TOKEN, TOKEN_2022].includes(address) || program?.executable !== true) return result;
  // Only the verified loader-v3 layout is accepted. Unknown/new loaders stay pending.
  if (program.owner !== UPGRADEABLE_LOADER || program.data?.parsed?.type !== 'program') return result;
  const dataAddress = program.data.parsed.info?.programData;
  if (typeof dataAddress !== 'string') return result;
  result.programData = dataAddress;
  if (data?.owner !== UPGRADEABLE_LOADER || data.executable !== false || data.data?.parsed?.type !== 'programData') return result;
  const authority = data.data.parsed.info?.authority;
  if (authority === null) return { ...result, immutable: true, reason: 'Token program upgrade authority is revoked' };
  if (typeof authority === 'string' && authority.length > 0)
    return { ...result, immutable: false, reason: 'Token program retains an upgrade authority' };
  return result;
}
export function assessMint(mint: string, account: any, program: ProgramEvidence | null, now: number, slot: number | null): TokenSecurity {
  const result = { ...pendingSecurity(mint), checkedAt: now, slot };
  if (!account) return { ...result, reasons: ['Mint account is unavailable'] };
  result.program = typeof account.owner === 'string' ? account.owner : null;
  if (!result.program) return result;
  if (![TOKEN, TOKEN_2022].includes(result.program)) return { ...result, status: 'excluded', reasons: ['Unsupported token program; controls cannot be approved'] };
  const parsed = account.data?.parsed, info = parsed?.info;
  if (account.executable !== false || parsed?.type !== 'mint' || info?.isInitialized !== true)
    return { ...result, reasons: ['Initialized mint account could not be verified'] };
  const authorityValid = (value: unknown) => value === null || typeof value === 'string' && value.length > 0;
  result.supplyRaw = typeof info.supply === 'string' && /^\d{1,20}$/.test(info.supply) && BigInt(info.supply) <= 18446744073709551615n ? info.supply : null;
  result.decimals = Number.isInteger(info.decimals) && info.decimals >= 0 && info.decimals <= 255 ? info.decimals : null;
  const reasons: string[] = [], unknown: string[] = [];
  result.authoritiesVerified = authorityValid(info.mintAuthority) && authorityValid(info.freezeAuthority);
  result.mintAuthority = typeof info.mintAuthority === 'string' ? info.mintAuthority : null;
  result.freezeAuthority = typeof info.freezeAuthority === 'string' ? info.freezeAuthority : null;
  if (!result.authoritiesVerified) unknown.push('Mint or freeze authority fields are missing');
  if (result.mintAuthority) reasons.push('Mint authority remains active');
  if (result.freezeAuthority) reasons.push('Freeze authority remains active');
  if (result.program === TOKEN && account.space !== 82) unknown.push('Unexpected legacy mint layout');
  if (result.program === TOKEN_2022) {
    if (!Array.isArray(info.extensions)) unknown.push('Token-2022 extension inventory is unavailable');
    else {
      result.extensions = info.extensions.map((e: any) => typeof e?.extension === 'string' ? e.extension : 'unknown');
      // Metadata and transfer-fee configurations are explicitly allowed by the user.
      // Hooks, delegates, pausing, default freezing and unknown extensions remain denied.
      const controls = result.extensions.filter(e => !['metadataPointer', 'tokenMetadata', 'transferFeeConfig'].includes(e));
      if (controls.length) reasons.push(`Unapproved token-control extensions: ${controls.join(', ')}`);
      const fee = info.extensions.find((e: any) => e?.extension === 'transferFeeConfig')?.state;
      if (result.extensions.includes('transferFeeConfig')) {
        const bpsValid = (n: unknown) => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 10_000;
        const rawValid = (s: unknown) => (typeof s === 'string' && /^\d+$/.test(s)) || (typeof s === 'number' && Number.isSafeInteger(s) && s >= 0);
        if (!fee || !bpsValid(fee.olderTransferFee?.transferFeeBasisPoints) || !bpsValid(fee.newerTransferFee?.transferFeeBasisPoints)
          || !Number.isSafeInteger(fee.newerTransferFee?.epoch) || !rawValid(fee.olderTransferFee?.maximumFee) || !rawValid(fee.newerTransferFee?.maximumFee)
          || !authorityValid(fee.transferFeeConfigAuthority) || !authorityValid(fee.withdrawWithheldAuthority)) unknown.push('Transfer-fee configuration details are unverified');
        else {
          result.transferFee = { olderBasisPoints: fee.olderTransferFee.transferFeeBasisPoints, newerBasisPoints: fee.newerTransferFee.transferFeeBasisPoints,
            newerEpoch: fee.newerTransferFee.epoch, olderMaximumRaw: String(fee.olderTransferFee.maximumFee), newerMaximumRaw: String(fee.newerTransferFee.maximumFee),
            configAuthority: fee.transferFeeConfigAuthority, withdrawAuthority: fee.withdrawWithheldAuthority };
          result.notices.push(`Transfer fees allowed by your policy: older schedule ${result.transferFee.olderBasisPoints / 100}%, newer schedule ${result.transferFee.newerBasisPoints / 100}% from epoch ${result.transferFee.newerEpoch}`);
          result.notices.push(fee.transferFeeConfigAuthority ? 'Transfer-fee settings can be changed by the retained fee authority' : 'Transfer-fee configuration authority is revoked');
        }
      }
    }
  }
  if (program?.address === result.program && fresh(program.checkedAt, now, RISK_POLICY.controlsMaxAge)) {
    result.programImmutable = program.immutable; result.programData = program.programData;
    if (program.immutable === false) {
      if (RISK_POLICY.requireImmutableProgram) reasons.push(program.reason);
      else result.notices.push('Standard shared token program is upgradeable; token-specific mint and freeze powers are checked separately');
    }
    if (program.immutable === null) unknown.push(program.reason);
  } else unknown.push('Token program upgrade status has not been verified');
  return { ...result, status: reasons.length ? 'excluded' : unknown.length ? 'pending' : 'passed',
    reasons: [...reasons, ...unknown].length ? [...reasons, ...unknown] : [
      'Mint and freeze authorities revoked', result.programImmutable ? 'Token program upgrade authority revoked' : 'Canonical token program verified; shared upgradeability is disclosed', 'No unapproved token-control extensions',
      'Metadata changes are allowed by your policy',
    ] };
}
const rawAmount = (value: unknown): value is string => typeof value === 'string' && /^[1-9]\d{0,38}$/.test(value);
export function parseQuote(data: any, inputMint: string, outputMint: string, amount: string, now: number): QuoteEvidence {
  if (data?.inputMint !== inputMint || data?.outputMint !== outputMint || data?.inAmount !== amount
    || !rawAmount(data?.outAmount) || data?.swapMode !== 'ExactIn' || data.error || data.errorCode
    || !Array.isArray(data.routePlan) || !data.routePlan.length) throw new Error('Quote route or amounts could not be verified');
  // Swap V2 priceImpact is percentage points. priceImpactPct is the older fraction.
  // Require the current field; never silently mix the two different units.
  if (typeof data.priceImpact !== 'number' || !Number.isFinite(data.priceImpact)) throw new Error('Quote price impact is unavailable');
  const pools = data.routePlan.map((r: any) => r?.swapInfo?.ammKey);
  if (pools.some((p: unknown) => typeof p !== 'string' || !p)) throw new Error('Quote route is incomplete');
  return { inputMint, outputMint, inAmount: amount, outAmount: data.outAmount,
    priceImpactPercent: Math.abs(data.priceImpact), pools: [...new Set<string>(pools)],
    router: typeof data.router === 'string' ? data.router : 'unknown', receivedAt: now };
}
export function assessLiquidity(pool: Pool, now: number): { status: 'pending' | 'excluded' | 'passed'; reasons: string[] } {
  if (!fresh(pool.metricsAt, now, RISK_POLICY.metricsMaxAge) || pool.liquidity === null || !Number.isFinite(pool.liquidity) || pool.liquidity < 0)
    return { status: 'pending', reasons: ['Recent liquidity data is unavailable'] };
  if (pool.liquidity < RISK_POLICY.minLiquidityUsd) return { status: 'excluded', reasons: ['Reported pool liquidity is below the $10,000 screening minimum'] };
  return { status: 'passed', reasons: [] };
}
export function assessTrading(pool: Pool, buy: QuoteEvidence, sell: QuoteEvidence, now: number): Tradeability {
  const base = { ...pendingTrading(pool), checkedAt: now, buy, sell };
  if (buy.inputMint !== USDC || buy.outputMint !== pool.mint || buy.inAmount !== RISK_POLICY.sampleUsdcRaw
    || sell.inputMint !== pool.mint || sell.outputMint !== USDC || sell.inAmount !== buy.outAmount
    || !rawAmount(buy.outAmount) || !rawAmount(sell.outAmount)
    || !fresh(buy.receivedAt, now, RISK_POLICY.quoteMaxAge) || !fresh(sell.receivedAt, now, RISK_POLICY.quoteMaxAge))
    return { ...base, reasons: ['Matching, recent buy and sell quotes are required'] };
  const lossRaw = BigInt(buy.inAmount) - BigInt(sell.outAmount);
  const loss = Number(lossRaw) / Number(buy.inAmount) * 100;
  const liquidity = assessLiquidity(pool, now), reasons = [...liquidity.reasons];
  if (!Number.isFinite(buy.priceImpactPercent) || !Number.isFinite(sell.priceImpactPercent)) return { ...base, reasons: ['Price impact is unavailable'] };
  if (Math.max(buy.priceImpactPercent, sell.priceImpactPercent) > RISK_POLICY.maxImpactPercent) reasons.push('Buy or sell price impact exceeds 5% for the 25 USDC sample');
  if (lossRaw * 100n > BigInt(RISK_POLICY.maxRoundTripLossPercent) * BigInt(buy.inAmount)) reasons.push('Quoted round-trip loss exceeds 10%, before network fees');
  const failed = liquidity.status === 'excluded' || reasons.some(r => /exceeds/.test(r));
  return { ...base, roundTripLossPercent: loss, status: failed ? 'excluded' : liquidity.status,
    reasons: reasons.length ? reasons : ['Buy and sell routes returned for a 25 USDC sample', 'Reported liquidity, quoted impact and round-trip loss are within screening limits'] };
}
export function combineRisk(pool: Pool, controls: TokenSecurity, trading: Tradeability, now: number): RiskAssessment {
  const validControls = controls.mint === pool.mint && controls.policyVersion === RISK_POLICY.version;
  const validTrading = trading.mint === pool.mint && trading.pool === pool.address && trading.policyVersion === RISK_POLICY.version;
  const liquidity = assessLiquidity(pool, now);
  const exclusions = [...(validControls && controls.status === 'excluded' ? controls.reasons : []),
    ...(validTrading && trading.status === 'excluded' && fresh(trading.checkedAt, now, RISK_POLICY.quoteMaxAge) ? trading.reasons : []),
    ...(liquidity.status === 'excluded' ? liquidity.reasons : [])];
  if (exclusions.length) return { status: 'excluded', reasons: exclusions, controls, trading };
  const pending: string[] = [];
  if (!validControls || !fresh(controls.checkedAt, now, RISK_POLICY.controlsMaxAge)) pending.push('Token controls need a current on-chain check');
  else if (controls.status !== 'passed') pending.push(...controls.reasons);
  if (liquidity.status !== 'passed') pending.push(...liquidity.reasons);
  if (!validTrading || !fresh(trading.checkedAt, now, RISK_POLICY.quoteMaxAge)
    || !fresh(trading.buy?.receivedAt ?? null, now, RISK_POLICY.quoteMaxAge) || !fresh(trading.sell?.receivedAt ?? null, now, RISK_POLICY.quoteMaxAge)) pending.push('Recent buy and sell quotes are required');
  else if (trading.status !== 'passed') pending.push(...trading.reasons);
  return { status: pending.length ? 'pending' : 'passed', reasons: pending.length ? pending : ['Token controls and sample quotes passed the screening policy'], controls, trading };
}
