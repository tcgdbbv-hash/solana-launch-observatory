import type { RangeAlert } from './types.ts';

export function alertCoinLabel(alert: Pick<RangeAlert, 'name' | 'symbol' | 'mint'>): string {
  const name=alert.name?.trim(), symbol=alert.symbol?.trim();
  if(name&&symbol&&name.toLowerCase()!==symbol.toLowerCase())return `${name} (${symbol})`;
  return name||symbol||`${alert.mint.slice(0,5)}…${alert.mint.slice(-4)}`;
}
