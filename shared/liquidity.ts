import type { Pool } from './types.ts';
export const LIQUIDITY_POLICY={version:'floor-1000-full-lp-protection-v2',minUsd:1000,maxAge:900_000};
export function knownLowLiquidity(pool: Pool, now=Date.now()) {
  return pool.metricsAt!==null&&pool.metricsAt<=now&&pool.liquidity!==null&&Number.isFinite(pool.liquidity)&&pool.liquidity>=0&&pool.liquidity<LIQUIDITY_POLICY.minUsd;
}
