import type { CapRange, Pool } from './types.ts';

export const RANGE_INFO: Record<CapRange, { code: string; label: string }> = {
  above: { code: 'A250', label: 'Above $250k' },
  within: { code: 'R30-250', label: 'In range · $30k–$250k' },
  below: { code: 'B30', label: 'Below $30k' },
  unknown: { code: 'UNK', label: 'Range unverified' },
};
export function freshReportedCap(pool: Pool, now: number): boolean {
  return pool.capBasis === 'provider_reported' && pool.marketCap !== null && Number.isFinite(pool.marketCap)
    && pool.marketCap > 0 && pool.metricsAt !== null && Number.isFinite(pool.metricsAt)
    && pool.metricsAt <= now && now - pool.metricsAt <= 120_000;
}
export function capRange(value: number): CapRange {
  return !Number.isFinite(value) || value <= 0 ? 'unknown' : value < 30_000 ? 'below' : value > 250_000 ? 'above' : 'within';
}
export function belowCapTone(value: number | null | undefined): 'cap-yellow' | 'cap-orange' | 'cap-red' | '' {
  if(value===null||value===undefined||!Number.isFinite(value)||value<0||value>=30_000)return '';
  return value>=20_000?'cap-yellow':value>=10_000?'cap-orange':'cap-red';
}
export function rangeMessage(from: CapRange, to: CapRange): string {
  if (from === 'unknown') return to === 'above' ? 'First observed above $250k' : to === 'below' ? 'First observed below $30k' : 'First observed in $30k–$250k range';
  if (to === 'above') return 'Moved above $250k';
  if (to === 'below') return 'Dropped below $30k';
  return from === 'above' ? 'Returned to $30k–$250k' : 'Recovered into $30k–$250k';
}
