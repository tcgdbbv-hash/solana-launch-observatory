export type Venue = 'PumpSwap' | 'Raydium' | 'Meteora';
export type Group = 'new' | 'watching' | 'above' | 'below' | 'archived' | 'pending' | 'excluded' | 'parked';
export type CapRange = 'below' | 'within' | 'above' | 'unknown';
export interface RangeAlert {
  kind?: 'range' | 'base_qualified' | 'base_lost';
  policyVersion?: string;
  id: number; code: string; chartCode: string; mint: string; pool: string; symbol: string; name?: string; venue?: Venue;
  from: CapRange; to: CapRange; marketCap: number; observedAt: number; source: string;
  message: string; eligibility: Group; readAt: number | null;
}
export interface AlertsPage { alerts: RangeAlert[]; unread: number; nextBefore: number | null; }
export interface UpdateThread { latest: RangeAlert; history: RangeAlert[]; totalEvents: number; unreadCount: number; }
export interface UpdatesPage { threads: UpdateThread[]; unread: number; nextBefore: number | null; }
export type CheckStatus = 'pending' | 'passed' | 'excluded';
export interface TokenSecurity {
  mint: string; status: CheckStatus; checkedAt: number | null; slot: number | null;
  program: string | null; mintAuthority: string | null; freezeAuthority: string | null;
  authoritiesVerified: boolean; programImmutable: boolean | null; programData: string | null;
  extensions: string[]; reasons: string[]; policyVersion: string;
  notices: string[];
  supplyRaw?: string | null; decimals?: number | null;
  transferFee: { olderBasisPoints: number; newerBasisPoints: number; newerEpoch: number;
    olderMaximumRaw: string; newerMaximumRaw: string; configAuthority: string | null; withdrawAuthority: string | null } | null;
}
export interface QuoteEvidence {
  inputMint: string; outputMint: string; inAmount: string; outAmount: string;
  priceImpactPercent: number; pools: string[]; router: string; receivedAt: number;
}
export interface Tradeability {
  mint: string; pool: string; status: CheckStatus; checkedAt: number | null;
  buy: QuoteEvidence | null; sell: QuoteEvidence | null; roundTripLossPercent: number | null;
  liquidity: number | null; liquidityAt: number | null; reasons: string[]; policyVersion: string;
}
export interface TradingProgress {
  state: 'current' | 'waiting_setup' | 'waiting_controls' | 'waiting_liquidity' | 'queued' | 'checking' | 'retry_wait' | 'rate_limited' | 'paused' | 'inactive';
  reason: string; lastAttemptAt: number | null; lastQuoteAt: number | null; nextAttemptAt: number | null;
}
export interface RiskAssessment {
  status: CheckStatus; reasons: string[]; controls: TokenSecurity; trading: Tradeability;
  manualReview?: ManualRiskReview | null;
  supply?: SupplyAssessment;
  liquidityProtection?: LiquidityProtection;
}
export interface LiquidityProtection {
  pool: string; mint: string; status: CheckStatus; checkedAt: number | null; slot: number | null;
  lpMint: string | null; burnedPercent: number | null; lockedPercent: number | null;
  lpTokenProgram?: string | null;
  totalLpRaw: string | null; liveLpRaw: string | null; lockedLpRaw: string | null;
  reasons: string[]; source: string; policyVersion: string;
}
export interface SupplyOrigin { mint: string; raw: string; decimals: number; signature?: string; account?: string; program?: string; platform?: string; slot: number; checkedAt: number; source: string; }
export interface LaunchOrigin {
  mint: string; platform: 'Pump.fun' | 'StonkFun' | 'Raydium LaunchLab'; program: string; account: string;
  quoteMint: string; platformConfig?: string; initialRaw: string | null; decimals: number;
  graduated: boolean; destinationPool: string | null; checkedAt: number; slot: number; version: string;
  source: string; notice?: string;
}
export interface SupplyAssessment { status: CheckStatus; reasons: string[]; currentRaw: string | null; decimals: number | null; origin: SupplyOrigin | null; }
export interface ManualRiskReview { mint: string; approved: boolean; createdAt: number; notes: string; scope: 'trading-screen'; }
export interface AuditEvent {
  id: number; time: number; category: string; entity: string; summary: string; data: unknown;
}
export interface ActivityPage { events: AuditEvent[]; nextBefore: number | null; total: number; }
export interface ChartFeedback {
  id: number; mint: string; pool: string; episodeId: number | null; createdAt: number;
  formation: 'match' | 'partial' | 'no_match' | 'unsure';
  base: 'still_pumping' | 'too_early' | 'forming' | 'established' | 'not_forming' | 'failed' | 'unclear';
  scope: 'in_scope' | 'borderline' | 'out_of_scope' | 'unsure';
  reason: string; notes: string;
}
export interface FeedbackSummary {
  tierReviews?: { total: number; latest: StageReview[] };
  totalReviews: number; reviewedCharts: number; latest: ChartFeedback[];
  formationCounts: Record<string, number>; reasonCounts: Record<string, number>;
  withoutDetection: number;
}
export type CapBasis = 'provider_reported' | 'fdv_only' | 'unknown';
export interface Pool {
  address: string; mint: string; quoteMint: string; symbol: string; name: string;
  venue: Venue; route: string; origin: string; evidence: string; source: string;
  createdAt: number | null; observedAt: number; activation: string;
  price: number | null; marketCap: number | null; fdv: number | null; capBasis: CapBasis;
  liquidity: number | null; volume5m: number | null; volume30m: number | null;
  volume1h: number | null; buys: number | null; sells: number | null; change5m: number | null;
  metricsAt: number | null; metricsSource: string; sourceAsOf: number | null;
  lastAttempt: number | null; candleAt: number | null; candleAttempt: number | null;
  screen: string; coverage: string; issue: string | null;
}
export interface TokenPoolContext {
  mint:string; preferredPool:string|null; checkedAt:number; source:string; reason:string;
  pools:{address:string;venue:Venue;route:string;liquidity:number|null;createdAt:number|null;observedAt:number}[];
}
export interface Candle { time: number; open: number; high: number; low: number; close: number; volume: number; }
export interface MinuteChartState { checkedAt: number | null; lastAttempt: number | null; issue: string | null; }
export interface DetectorSettings {
  riseMultiple: number; volumeMultiple: number; minActiveBars: number;
  pullbackMin: number; pullbackMax: number; windows: number[]; cooldownMinutes: number;
}
export const DEFAULT_DETECTOR: DetectorSettings = {
  riseMultiple: 2, volumeMultiple: 3, minActiveBars: 3,
  pullbackMin: 0.2, pullbackMax: 0.75, windows: [3, 6, 12, 24, 36, 48, 72], cooldownMinutes: 360,
};
export interface Signal {
  start: number; trigger: number; lastTime: number; peak: number; initialClose: number;
  rise: number; volume: number; volumeRatio: number | null; volumeQualified: boolean;
  pullback: number; stage: 'Pump developing' | 'Pump + pullback' | 'Deep retracement';
  reasons: string[]; version: string;
  settings: DetectorSettings; volumeConfirmedAt: number | null;
}
export interface Episode { id: number; pool: string; mint: string; detectedAt: number; signal: Signal; original: Signal; }
export interface Candidate {
  mint: string; pool: string; qualifiedAt: number; reviewed: boolean; pinned: boolean;
  archived: boolean; below: boolean | null; lastCapAt: number | null;
  capRange?: CapRange; lastMarketCap?: number | null;
  label: string; updatedAt: number;
  manualWatch?: boolean; researchTags?: import('./research.ts').ResearchTag[];
  manualStage?: { stage: import('./shortlist.ts').ShortlistStage; reason: string; changedAt: number; reviewId: number } | null;
}
export interface StageReview {
  id: number; requestId: string; mint: string; pool: string; createdAt: number;
  fromStage: import('./shortlist.ts').ShortlistStage | null;
  toStage: import('./shortlist.ts').ShortlistStage | null;
  automaticStage: import('./shortlist.ts').ShortlistStage | null;
  previousManualStage: Candidate['manualStage']; reason: string; source: 'human'; version: string;
}
export interface DrawdownAssessment {
  version: string; pool: string; peakPrice: number; peakAt: number; peakSource: string;
  price: number; priceAt: number; percent: number; worstPercent: number; troughPrice: number; troughAt: number;
  thresholdPercent: number; recoveryBelowPercent: number; held: boolean;
}
export interface CandidateRow extends Candidate {
  drawdown?: DrawdownAssessment | null;
  tradingProgress?: TradingProgress;
  base?: BaseAssessment | null;
  shortlistedAt?: number | null;
  chartCode: string; capRange: CapRange;
  group: Group; poolData: Pool; episode: Episode; episodesCount: number; notesCount: number;
  risk: RiskAssessment;
}
export interface Note { id: number; mint: string; body: string; label: string; createdAt: number; }
export interface Crossing { id: number; mint: string; kind: string; value: number; observedAt: number; source: string; }
export interface SourceHealth {
  id: string; name: string; state: 'idle' | 'ok' | 'error' | 'limited' | 'disabled';
  detail: string; lastSuccess: number | null; lastAttempt: number | null;
  requests: number; errors: number; nextAt: number;
}
export interface CoverageRoute { route: string; state: string; detail: string; }
export const COVERAGE: CoverageRoute[] = [
  { route: 'PumpSwap graduations', state: 'Partial', detail: 'Free PumpPortal migration events + indexed destination-pool resolution. Disconnect history is not guaranteed.' },
  { route: 'Raydium LaunchLab → CPMM', state: 'Partial', detail: 'Migration signer RPC reconciliation + indexed pool lookup. Public RPC can throttle; signer list needs ongoing verification.' },
  { route: 'Other Raydium / legacy AMM', state: 'Indexed only', detail: 'Secondary indexed discovery; full origin and migration decoder coverage is still required.' },
  { route: 'Meteora DLMM', state: 'Context only', detail: 'New DLMM pools trigger exact-mint lookups for deeper PumpSwap/Raydium pools. Creation timing and secondary liquidity are retained. No Meteora chart screening or range alerts.' },
  { route: 'Meteora DAMM v1 / DBC provenance', state: 'Paused by you', detail: 'Outside the current live scope. Historical indexed records remain available.' },
];
export interface Overview {
  candleScheduling?: import('./candle-policy.ts').CandleReport;
  mode: 'live'; running: boolean; asOf: number; startedAt: number;
  candidates: CandidateRow[]; pools: Pool[]; totalPools: number;
  health: SourceHealth[]; coverage: CoverageRoute[]; settings: DetectorSettings;
  counts: Record<Group, number>; pendingMetrics: number; pendingCandles: number;
  requestsToday: number; storageBytes: number;
  controls: Record<string, TokenSecurity>;
  withinCount: number; unreadAlerts: number; latestAlert: RangeAlert | null; latestUnreadAlert: RangeAlert | null;
  chartCodes: Record<string, string>;
  poolContexts: Record<string,TokenPoolContext>;
  liveScope: readonly Venue[]; historicalPoolCount: number; ignoredPoolCount: number;
}
export interface Detail {
  stageReviews?: StageReview[];
  tradingProgress?: TradingProgress;
  launchOrigin?: LaunchOrigin | null;
  base?: BaseAssessment | null;
  checksRequestedAt?: number | null;
  supplySearch?: {pages:number;nextAt:number;remaining:number;exhausted:boolean;lastAttempt:number|null;issue:string} | null;
  chartCode: string;
  row: CandidateRow | null; pool: Pool; candles: Candle[];
  candles1m: Candle[]; minuteChart: MinuteChartState; minuteSource: string | null;
  episodes: Episode[]; notes: Note[]; crossings: Crossing[]; pools: Pool[];
  candleSource: string | null; asOf: number;
  risk: RiskAssessment;
  feedback: ChartFeedback[];
  poolContext: TokenPoolContext | null;
}

export interface BaseAssessment {
  version: string; pool: string; mint: string; evaluatedAt: number; candleEnd: number | null;
  status: 'qualified' | 'forming' | 'insufficient' | 'inactive';
  reasons: string[]; score: number; start: number | null; end: number | null;
  durationHours: number; floor: number | null; ceiling: number | null;
  widthPercent: number | null; driftPercent: number | null; activePercent: number | null;
  floorTests: number; ceilingTests: number; volumeUsd: number; coveragePercent: number;
  pumpTrigger: number | null; pumpPeakTime: number | null; pumpPeak: number | null;
  pullbackPercent: number | null; launchBasis: 'pool_creation' | 'unknown';
  shape: 'sideways' | 'rising' | 'unsettled';
  rawWidthPercent: number | null; trendPercentPerHour: number | null; trendGainPercent: number | null;
  floorStart: number | null; ceilingStart: number | null;
  tightnessTier: 1 | 2 | 3 | 4 | 5 | null;
  compression: 'tightening' | 'steady' | 'widening' | 'unknown';
  compressionRatio: number | null; priorityBoost: number;
}
