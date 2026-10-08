import type { Candle, Pool, Venue } from '../shared/types.ts';
import { validCandle } from './detector.ts';

export const SOL = 'So11111111111111111111111111111111111111112';
const QUOTES = new Set([SOL, 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', '2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH']);
export const addressValid = (s: unknown): s is string => typeof s === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
export function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value); return Number.isFinite(n) && n >= 0 ? n : null;
}
export function blankPool(address: string, mint: string, venue: Venue, now: number): Pool {
  return { address, mint, quoteMint: '', symbol: '', name: '', venue, route: venue, origin: 'Unknown', evidence: '', source: '',
    createdAt: null, observedAt: now, activation: 'Unknown', price: null, marketCap: null, fdv: null, capBasis: 'unknown',
    liquidity: null, volume5m: null, volume30m: null, volume1h: null, buys: null, sells: null, change5m: null,
    metricsAt: null, metricsSource: '', sourceAsOf: null, lastAttempt: null, candleAt: null, candleAttempt: null,
    screen: 'Waiting for activity data', coverage: 'Observed since discovery; earlier coverage unverified', issue: null };
}
export function meteoraPool(row: any, route: string, now: number): Pool | null {
  const x = row?.token_x, y = row?.token_y;
  if (!addressValid(row?.address) || !addressValid(x?.address) || !addressValid(y?.address)) return null;
  const base = QUOTES.has(x.address) && !QUOTES.has(y.address) ? y : x;
  const quote = base === x ? y : x;
  const p = blankPool(row.address, base.address, 'Meteora', now);
  const price = num(base.price), supply = num(base.total_supply);
  return { ...p, quoteMint: quote.address, symbol: String(base.symbol || '').slice(0,40), name: String(base.name || '').slice(0,100), route,
    source: 'Meteora native pool index', origin: 'Unknown', evidence: row.launchpad ? `Indexer launchpad label: ${String(row.launchpad).slice(0,100)}; migration unverified` : 'Native pool listing; direct-seed/DBC origin unverified',
    createdAt: num(row.created_at), activation: (num(row.volume?.['24h']) ?? 0) > 0 ? 'Trading observed' : (num(row.tvl) ?? 0) > 0 ? 'Funded; activation unverified' : 'Funding unverified',
    price: price && price > 0 ? price : null, fdv: price && supply ? price * supply : null,
    // Native token.market_cap can equal total_supply × price. Do not promote it to circulating market cap.
    capBasis: price && supply ? 'fdv_only' : 'unknown', liquidity: num(row.tvl), volume30m: num(row.volume?.['30m']),
    volume1h: num(row.volume?.['1h']), metricsAt: now, lastAttempt: now, metricsSource: 'Meteora native; 30m / 1h reported windows' };
}
export function dexVenue(dex: string): Venue | null {
  if (dex === 'pumpswap' || dex === 'pump-swap') return 'PumpSwap';
  if (dex === 'raydium' || dex.startsWith('raydium-')) return 'Raydium';
  if (dex === 'meteora' || dex.startsWith('meteora-')) return 'Meteora';
  return null; // In particular, pumpfun is a curve, not PumpSwap.
}
export function dexPool(row: any, now: number, existing?: Pool): Pool | null {
  const venue = dexVenue(String(row?.dexId));
  if (!venue || row.chainId !== 'solana' || !addressValid(row.pairAddress) || !addressValid(row.baseToken?.address)) return null;
  if (existing && (existing.address !== row.pairAddress || existing.mint !== row.baseToken.address)) return null;
  const p = existing ?? blankPool(row.pairAddress, row.baseToken.address, venue, now);
  const marketCap = num(row.marketCap), fdv = num(row.fdv), change = Number(row.priceChange?.m5);
  return { ...p, quoteMint: row.quoteToken?.address ?? p.quoteMint, symbol: String(row.baseToken.symbol || p.symbol).slice(0,40),
    name: String(row.baseToken.name || p.name).slice(0,100), source: p.source || 'DEX Screener pair lookup',
    route: Array.isArray(row.labels)&&row.labels.length?row.labels.join(' · '):p.route,
    createdAt: p.createdAt ?? num(row.pairCreatedAt), price: num(row.priceUsd), marketCap: marketCap && marketCap > 0 ? marketCap : null,
    fdv, capBasis: marketCap && marketCap > 0 ? 'provider_reported' : fdv ? 'fdv_only' : 'unknown',
    liquidity: num(row.liquidity?.usd), volume5m: num(row.volume?.m5), volume1h: num(row.volume?.h1),
    buys: num(row.txns?.m5?.buys), sells: num(row.txns?.m5?.sells), change5m: Number.isFinite(change) ? change : null,
    metricsAt: now, lastAttempt: now, metricsSource: 'DEX Screener', sourceAsOf: null, issue: null,
    activation: (num(row.volume?.h1) ?? 0) > 0 ? 'Trading observed' : p.activation };
}
export function geckoPool(row: any, now: number): Pool | null {
  const a = row?.attributes, rel = row?.relationships;
  const dex = String(rel?.dex?.data?.id ?? '');
  const venue = dexVenue(dex);
  const mint = String(rel?.base_token?.data?.id ?? '').replace(/^solana_/, '');
  const quoteMint = String(rel?.quote_token?.data?.id ?? '').replace(/^solana_/, '');
  if (!venue || !addressValid(a?.address) || !addressValid(mint)) return null;
  const p = blankPool(a.address, mint, venue, now), name = String(a.name ?? '');
  const cap = num(a.market_cap_usd), fdv = num(a.fdv_usd), created = Date.parse(a.pool_created_at);
  return { ...p, quoteMint, symbol: name.split(' / ')[0].slice(0,40), name: name.slice(0,100), route: dex,
    source: 'GeckoTerminal pool index', evidence: 'Indexed pool; launch origin unverified', createdAt: Number.isFinite(created) ? created : null,
    price: num(a.base_token_price_usd), marketCap: cap && cap > 0 ? cap : null, fdv,
    capBasis: cap && cap > 0 ? 'provider_reported' : fdv ? 'fdv_only' : 'unknown', liquidity: num(a.reserve_in_usd),
    volume5m: num(a.volume_usd?.m5), volume1h: num(a.volume_usd?.h1), buys: num(a.transactions?.m5?.buys), sells: num(a.transactions?.m5?.sells),
    metricsAt: now, lastAttempt: now, metricsSource: 'GeckoTerminal', activation: (num(a.volume_usd?.h1) ?? 0) > 0 ? 'Trading observed' : 'Unknown' };
}
export function geckoCandles(payload: any, mint: string, minutes: 1 | 5 = 5): Candle[] {
  const meta = payload?.meta;
  // The request uses the explicit mint; metadata must confirm which token the candles describe.
  if (meta?.base?.address !== mint && meta?.quote?.address !== mint) throw new Error('Candle token identity could not be verified');
  const rows = payload?.data?.attributes?.ohlcv_list;
  if (!Array.isArray(rows)) throw new Error('Candle response has no OHLCV list');
  return rows.map((r: number[]) => ({ time: r[0], open: r[1], high: r[2], low: r[3], close: r[4], volume: r[5] })).filter((c: Candle) => validCandle(c, minutes));
}
