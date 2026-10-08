import type { DrawdownAssessment, Pool } from './types.ts';

export const DRAWDOWN_POLICY = { version: 'observed-close-drawdown-v2', holdPercent: 95, recoveryBelowPercent: 90 } as const;
export interface ObservedPeak { price: number; at: number; source: string; troughPrice?: number; troughAt?: number; }
export function assessDrawdown(pool: Pool, peak: ObservedPeak | null, now: number): DrawdownAssessment | null {
  if (!peak || !Number.isFinite(peak.price) || peak.price <= 0 || peak.at > now
    || !pool.metricsAt || pool.metricsAt > now || pool.metricsAt < peak.at
    || pool.price === null || !Number.isFinite(pool.price) || pool.price <= 0) return null;
  const percent = Math.max(0, (1 - pool.price / peak.price) * 100);
  const validTrough=peak.troughPrice!==undefined&&Number.isFinite(peak.troughPrice)&&peak.troughPrice>0
    &&peak.troughAt!==undefined&&peak.troughAt>=peak.at&&peak.troughAt<=pool.metricsAt;
  const troughPrice=validTrough?Math.min(pool.price,peak.troughPrice!):pool.price;
  const troughAt=validTrough&&peak.troughPrice!<pool.price?peak.troughAt!:pool.metricsAt;
  const worstPercent=Math.max(percent,(1-troughPrice/peak.price)*100);
  return { version: DRAWDOWN_POLICY.version, pool: pool.address, peakPrice: peak.price, peakAt: peak.at,
    peakSource: peak.source, price: pool.price, priceAt: pool.metricsAt, percent,worstPercent,troughPrice,troughAt,
    thresholdPercent: DRAWDOWN_POLICY.holdPercent,recoveryBelowPercent:DRAWDOWN_POLICY.recoveryBelowPercent,
    held:worstPercent>=DRAWDOWN_POLICY.holdPercent&&percent>=DRAWDOWN_POLICY.recoveryBelowPercent };
}
export const extremeDrawdown = (d: DrawdownAssessment | null | undefined) =>
  !!d && d.version === DRAWDOWN_POLICY.version && d.held;
