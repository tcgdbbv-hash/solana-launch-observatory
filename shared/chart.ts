import type { Candle, Pool } from './types.ts';

// A chart display conversion, never an input to range alerts or the detector.
// The ratio is an implied supply at one provider observation, not historical supply.
export function marketCapFactor(pool: Pool, now = Date.now()): number | null {
  if (pool.capBasis !== 'provider_reported' || pool.marketCap === null || pool.price === null
    || !Number.isFinite(pool.marketCap) || !Number.isFinite(pool.price) || pool.marketCap <= 0 || pool.price <= 0
    || pool.metricsAt === null || !Number.isFinite(pool.metricsAt) || pool.metricsAt > now) return null;
  const factor = pool.marketCap / pool.price;
  return Number.isFinite(factor) && factor > 0 ? factor : null;
}
export function scaleChart(bars: Candle[], factor: number): Candle[] {
  return bars.map(c => ({ ...c, open: c.open * factor, high: c.high * factor, low: c.low * factor, close: c.close * factor }));
}
