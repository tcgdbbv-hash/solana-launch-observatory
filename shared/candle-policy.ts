export const CANDLE_POLICY = 'snapshot-priority-v1';
export type CandleMode = 'legacy' | 'priority';
export type CandleProfile = 'balanced' | 'discovery';
export type CandleClass = 'promising' | 'first' | 'early' | 'revisit' | 'support';
export const CANDLE_SHARES: Record<CandleClass, number> = { promising: 50, first: 20, early: 0, revisit: 20, support: 10 };
export const CANDLE_PROFILES = {
  balanced: { version: CANDLE_POLICY, label: 'Previous candle balance', shares: CANDLE_SHARES,
    rotation: ['promising','first','promising','revisit','promising','support','first','promising','revisit','promising'] as CandleClass[] },
  discovery: { version: 'discovery-early-priority-v2', label: 'Discovery & Early signs',
    shares: { promising: 20, first: 35, early: 25, revisit: 15, support: 5 } as Record<CandleClass,number>,
    rotation: ['first','early','promising','first','revisit','early','first','promising','early','support',
      'first','revisit','early','promising','first','early','revisit','first','promising','first'] as CandleClass[] },
} as const;
export const CANDLE_LABELS: Record<CandleClass, string> = {
  promising: 'Promising bases', first: 'First chart checks', early: 'Early signs refreshes', revisit: 'Quiet chart revisits', support: 'History & chart views',
};
export interface SnapshotPoint {
  time: number; price: number | null; liquidity: number | null; volume5m: number | null;
  buys: number | null; sells: number | null; source: string;
}
export interface SnapshotScreen {
  at: number; score: number; promising: boolean; coverage: number; hours: number;
  width: number | null; slope: number | null; contraction: number | null; reasons: string[];
}
export interface CandleJob {
  id: string; pool: string; mint: string; kind: 'latest' | 'history' | 'minute'; class: CandleClass;
  reason: string; score: number; dueAt: number; enqueuedAt: number; state: 'queued' | 'running' | 'done' | 'obsolete';
  lastAttempt: number | null; failures: number; nextAt: number; before?: number;
  refreshBy?: number;
}
export interface CandleReport {
  profile: CandleProfile; profileChangedAt: number | null;
  firstWaitMs: number; earlyOverdue: number; earlyRefreshes: number;
  profileBaseline: { at:number; minutes:number; attempts:number; firstChecks:number; firstWaiting:number; firstWaitMs:number } | null;
  mode: CandleMode; version: string; changedAt: number | null; asOf: number; since: number;
  pace: number; cooldownUntil: number; queue: Record<CandleClass, number>; oldestWaitMs: number;
  attempts: number; successes: number; limited: number; distinctTokens: number; firstChecks: number;
  providerAttempts: number; providerLimited: number;
  newBars: number; stale: number; sampledRevisits: number; sampledQualified: number;
  shares: { key: CandleClass; label: string; target: number; attempts: number }[];
  recent: { time: number; symbol: string; mint: string; pool: string; reason: string; outcome: string; newBars: number }[];
  baseline: { at: number; minutes: number; attempts: number; successes: number; limited: number } | null;
}
