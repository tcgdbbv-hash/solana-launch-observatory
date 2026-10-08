import type { BaseAssessment, Pool } from './types.ts';

export const BASE_VERSION = 'base-2';
export const BASE_MAX_AGE = 30 * 60_000;
export const BASE_POLICY = {
  version: BASE_VERSION,
  windowsHours: [1, 2, 4, 8, 12, 24, 48, 96, 168, 336],
  launchWindowHours: 6,
  maxWidthPercent: 30,
  maxDriftPercent: 12,
  minRisingGainPercent: 5,
  maxRisingPercentPerHour: 8,
  maxSlopeVsPump: .35,
  minCoveragePercent: 85,
  minActivePercent: 65,
  minFloorTests: 3,
  minCeilingTests: 2,
  minPullbackPercent: 20,
} as const;
// Describes observed band width, not a trading signal or confidence score.
export function tightnessTier(width: number): 1 | 2 | 3 | 4 | 5 {
  return width <= 5 ? 5 : width <= 10 ? 4 : width <= 15 ? 3 : width <= 25 ? 2 : 1;
}
export function currentBase(base: BaseAssessment | null | undefined, now = Date.now()) {
  return !!base && base.version === BASE_VERSION && base.status === 'qualified'
    && base.candleEnd !== null && base.candleEnd <= now && now - base.candleEnd <= BASE_MAX_AGE;
}

// Fresh activity metrics can arrive before the next candle. Do not admit an old
// base after price has already broken out of it. Extend a rising channel only
// to that metric's observation time, within the same bounded freshness window.
export function priceWithinBase(base: BaseAssessment | null | undefined, pool: Pool, now = Date.now()) {
  if(!currentBase(base,now)||!base?.end||!base.floor||!base.ceiling||!pool.price||!pool.metricsAt
    ||pool.price<=0||pool.metricsAt<base.end||pool.metricsAt>now)return false;
  const elapsed=(pool.metricsAt-base.end)/3_600_000;
  if(elapsed>BASE_MAX_AGE/3_600_000)return false;
  const factor=base.shape==='rising'?Math.pow(1+(base.trendPercentPerHour??0)/100,elapsed):1;
  return pool.price>=base.floor*factor*.97&&pool.price<=base.ceiling*factor*1.03;
}
