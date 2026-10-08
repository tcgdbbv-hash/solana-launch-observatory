import { DEFAULT_DETECTOR, type Candle, type DetectorSettings, type Signal } from '../shared/types.ts';

export const DETECTOR_VERSION = 'rules-0.2';
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  return n ? n % 2 ? sorted[n >> 1] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2 : 0;
};
export function validCandle(c: Candle, minutes: 1 | 5 = 5): boolean {
  return [c.time, c.open, c.high, c.low, c.close, c.volume].every(Number.isFinite)
    && c.time % (minutes * 60) === 0 && Math.min(c.open, c.high, c.low, c.close) > 0 && c.volume >= 0
    && c.high >= Math.max(c.open, c.close) && c.low <= Math.min(c.open, c.close);
}
export function closedCandles(input: Candle[], asOf: number, minutes: 1 | 5 = 5): Candle[] {
  return [...new Map(input.filter(c => validCandle(c, minutes) && c.time * 1000 + minutes * 60_000 <= asOf - 30_000)
    .map(c => [c.time, c])).values()].sort((a, b) => a.time - b.time);
}
const continuous = (bars: Candle[]) => bars.every((c, i) => i === 0 || c.time - bars[i - 1].time === 300);

// Replays prefixes in chronological order. No future bars can establish an earlier signal.
export function detectEpisodes(input: Candle[], asOf: number, settings: DetectorSettings = DEFAULT_DETECTOR): Signal[] {
  const bars = closedCandles(input, asOf);
  const signals: Signal[] = [];
  let current: Signal | undefined;
  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    if (current) {
      current.peak = Math.max(current.peak, bar.close);
      current.lastTime = bar.time;
      current.pullback = Math.max(0, 1 - bar.close / current.peak);
      current.stage = current.pullback > settings.pullbackMax ? 'Deep retracement'
        : current.pullback >= settings.pullbackMin ? 'Pump + pullback' : 'Pump developing';
    }
    for (const n of settings.windows) {
      if (i < n - 1) continue;
      const leg = bars.slice(i - n + 1, i + 1);
      if (!continuous(leg)) continue;
      const rise = bar.close / leg[0].close;
      if (rise < settings.riseMultiple || leg.filter(c => c.volume > 0).length < settings.minActiveBars) continue;
      const advancing = leg.slice(1).filter((c, j) => c.close > leg[j].close).length;
      if (advancing < Math.max(2, Math.ceil((n - 1) * 0.6))) continue;
      const prior = bars.slice(Math.max(0, i - 2 * n + 1), i - n + 1);
      // A multi-hour rise can start soon after launch: use the available same-coin
      // baseline (at least three bars), without demanding hours of pre-launch data.
      const base = prior.length >= 3 && continuous([...prior, leg[0]]) ? median(prior.map(c => c.volume)) : 0;
      const volume = leg.reduce((sum, c) => sum + c.volume, 0);
      const volumeRatio = base > 0 ? (volume / n) / base : null;
      const volumeQualified = volumeRatio !== null && volumeRatio >= settings.volumeMultiple;
      // Price-only signals are retained as provisional. A missing baseline is never a volume confirmation.
      if (volumeRatio !== null && !volumeQualified) continue;
      if (current && bar.time - current.trigger < settings.cooldownMinutes * 60) {
        if (!current.volumeQualified && volumeQualified) {
          current.volumeQualified = true;
          current.volumeRatio = volumeRatio;
          current.volumeConfirmedAt = bar.time + 300;
          current.reasons[1] = `Volume confirmed on a later ${n * 5}-minute window: ${volumeRatio!.toFixed(2)}× the preceding median, ending ${new Date((bar.time + 300) * 1000).toISOString()}. Initial price flag was provisional.`;
        }
        break;
      }
      current = {
        start: leg[0].time, trigger: bar.time, lastTime: bar.time, peak: bar.close, initialClose: leg[0].close,
        rise, volume, volumeRatio, volumeQualified, pullback: 0, stage: 'Pump developing', version: DETECTOR_VERSION,
        settings: structuredClone(settings), volumeConfirmedAt: volumeQualified ? bar.time + 300 : null,
        reasons: [
          `${rise.toFixed(2)}× close-to-close rise over ${n * 5} minutes.`,
          volumeQualified ? `${volumeRatio!.toFixed(2)}× mean candle volume versus this coin’s preceding ${prior.length} candles (median).`
            : 'Provisional: this coin has no usable preceding volume baseline yet.',
          `${advancing} advancing closes; ${leg.filter(c => c.volume > 0).length} active candles.`,
        ],
      };
      signals.push(current);
      break;
    }
  }
  return signals;
}

export function aggregateCandles(input: Candle[], minutes: number): Candle[] {
  if (minutes === 5) return input;
  const buckets = new Map<number, Candle[]>();
  for (const c of input) {
    const time = Math.floor(c.time / (minutes * 60)) * minutes * 60;
    buckets.set(time, [...(buckets.get(time) ?? []), c]);
  }
  return [...buckets.entries()].sort(([a], [b]) => a - b).flatMap(([time, raw]) => {
    const bars = raw.sort((a, b) => a.time - b.time);
    if (bars.length !== minutes / 5 || bars[0].time !== time || !continuous(bars)) return [];
    return [{ time, open: bars[0].open, high: Math.max(...bars.map(c => c.high)),
      low: Math.min(...bars.map(c => c.low)), close: bars.at(-1)!.close, volume: bars.reduce((sum, c) => sum + c.volume, 0) }];
  });
}
