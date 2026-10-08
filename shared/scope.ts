import type { Pool, Venue } from './types.ts';

// User paused Meteora on 2026-09-27. Historical records remain available.
export const ACTIVE_VENUES: readonly Venue[] = ['PumpSwap', 'Raydium'];
export const inScope = (pool: Pick<Pool, 'venue'>) => ACTIVE_VENUES.includes(pool.venue);
export const isDlmm = (pool: Pick<Pool,'venue'|'route'>) => pool.venue==='Meteora'&&/dlmm/i.test(pool.route);
