import type { BaseAssessment, CandidateRow } from './types.ts';
import { BASE_MAX_AGE, BASE_POLICY, BASE_VERSION, priceWithinBase } from './base.ts';
import { shortlisted } from './research.ts';
import { inScope } from './scope.ts';
import { freshReportedCap } from './ranges.ts';
import { LIQUIDITY_POLICY } from './liquidity.ts';
import { extremeDrawdown } from './drawdown.ts';

export const SHORTLIST_STAGES = {
  early: { number: 1, label: 'Early signs', summary: 'Rise + pullback',
    description: 'An earlier rise and pullback have been detected. A supported base has not yet been confirmed. Checks may still be pending.',
    empty: 'No early setups to inspect', emptyHelp: 'Charts appear here after a supported rise and pullback, with recent chart data and activity. Raw launches stay in background observations.' },
  forming: { number: 2, label: 'Base forming', summary: 'Range taking shape',
    description: 'A supported range is taking shape, or a formed base is waiting for its checks. Each chart shows what is still needed.',
    empty: 'No bases taking shape right now', emptyHelp: 'Charts appear here when the range is supported but needs more tests, or when a formed base is waiting for checks.' },
  ready: { number: 3, label: 'Ready to review', summary: 'Base + checks confirmed',
    description: 'Automatic entries have an active base and passed checks. Coins you place here are marked as your choice, with the scanner’s assessment kept separate.',
    empty: 'No setups ready for review', emptyHelp: 'The scanner is watching in the background. A chart reaches this final stage once its base and required checks qualify.' },
} as const;
export type ShortlistStage = keyof typeof SHORTLIST_STAGES;

// These are read-only views of evidence already collected. They neither admit
// coins nor change the detector, request queue, notifications or human tags.
function freshBase(b: BaseAssessment | null | undefined, now: number): b is BaseAssessment {
  return !!b && b.version === BASE_VERSION && b.candleEnd !== null
    && b.candleEnd <= now && now - b.candleEnd <= BASE_MAX_AGE;
}
// Scheduling evidence only: allow a recently expired Early signs chart to earn
// a refresh. This never changes the 30-minute admission rule or saved candles.
export function earlySignsRefreshEligible(c: CandidateRow, now=Date.now()): boolean {
  const p=c.poolData,b=c.base,e=c.episode,s=e?.signal;
  return !c.archived&&!c.researchTags?.includes('not_matching')&&!extremeDrawdown(c.drawdown)&&inScope(p)
    &&!['excluded','parked','archived'].includes(c.group)&&c.risk.status!=='excluded'
    &&freshReportedCap(p,now)&&p.liquidity!==null&&Number.isFinite(p.liquidity)&&p.liquidity>=LIQUIDITY_POLICY.minUsd
    &&!!b&&b.version===BASE_VERSION&&b.pool===p.address&&b.mint===p.mint&&b.candleEnd!==null
    &&b.candleEnd<=now&&now-b.candleEnd<=86_400_000&&!['inactive','qualified'].includes(b.status)
    &&!!s&&e.pool===p.address&&e.mint===p.mint&&e.detectedAt<=now&&s.volumeQualified
    &&s.volumeConfirmedAt!==null&&s.volumeConfirmedAt*1000<=now&&s.trigger*1000<=now
    &&s.stage!=='Pump developing'&&Number.isFinite(s.pullback)&&s.pullback>=s.settings.pullbackMin
    &&((p.buys??0)+(p.sells??0)>0||(p.volume5m??0)>0);
}
function formingRange(c: CandidateRow, now: number) {
  const b = c.base, p = c.poolData;
  if (!freshBase(b, now) || b.status !== 'forming' || b.shape === 'unsettled'
    || b.durationHours < 1 || b.coveragePercent < BASE_POLICY.minCoveragePercent
    || (b.activePercent ?? 0) < BASE_POLICY.minActivePercent
    || (b.pullbackPercent ?? 0) < BASE_POLICY.minPullbackPercent
    || b.widthPercent === null || b.widthPercent < .25 || b.widthPercent > BASE_POLICY.maxWidthPercent
    || b.floorTests < 2 || b.ceilingTests < 1) return false;
  // The existing detector also calls unstable, falling and fast-rising charts
  // "forming". Only the missing-retests case earns the middle shortlist stage.
  if (!b.reasons.length || b.reasons.some(r => r !== 'The floor and ceiling need more distinct tests.')) return false;
  if (!b.end || !b.floor || !b.ceiling || !p.price || !p.metricsAt || p.metricsAt < b.end || p.metricsAt > now) return false;
  const elapsed = (p.metricsAt - b.end) / 3_600_000;
  if (elapsed > BASE_MAX_AGE / 3_600_000) return false;
  const factor = b.shape === 'rising' ? Math.pow(1 + (b.trendPercentPerHour ?? 0) / 100, elapsed) : 1;
  return p.price >= b.floor * factor * .97 && p.price <= b.ceiling * factor * 1.03;
}
export function automaticShortlistStage(c: CandidateRow, now = Date.now()): ShortlistStage | null {
  // Keep final-stage membership exactly equal to the existing shortlist.
  if (shortlisted(c, now)) return 'ready';
  const p = c.poolData, b = c.base, e = c.episode;
  if (extremeDrawdown(c.drawdown) || c.archived || c.researchTags?.includes('not_matching') || !inScope(p)
    || ['excluded', 'parked', 'archived'].includes(c.group) || c.risk.status === 'excluded'
    || !freshReportedCap(p, now) || p.liquidity === null || !Number.isFinite(p.liquidity)
    || p.liquidity < LIQUIDITY_POLICY.minUsd || !freshBase(b, now)
    || b.pool !== p.address || b.mint !== p.mint || b.status === 'inactive') return null;
  if (priceWithinBase(b, p, now) || formingRange(c, now)) return 'forming';
  // A base already left behind is not relabelled as an early setup.
  if (b.status === 'qualified') return null;
  const s = e?.signal;
  if (!s || e.pool !== p.address || e.mint !== p.mint || e.detectedAt > now
    || !s.volumeQualified || s.volumeConfirmedAt === null || s.volumeConfirmedAt * 1000 > now
    || s.trigger * 1000 > now || s.stage === 'Pump developing'
    || !Number.isFinite(s.pullback) || s.pullback < s.settings.pullbackMin
    || !((p.buys ?? 0) + (p.sells ?? 0) > 0 || (p.volume5m ?? 0) > 0)) return null;
  return 'early';
}

export function manualStageBlock(c: CandidateRow, now = Date.now()): string | null {
  if (c.archived || c.researchTags?.includes('not_matching')) return 'Restore this archived chart before placing it in a tier.';
  if (!inScope(c.poolData)) return 'Only PumpSwap and Raydium charts can be placed in shortlist tiers.';
  if (c.poolData.liquidity === null || !Number.isFinite(c.poolData.liquidity) || c.poolData.liquidity < LIQUIDITY_POLICY.minUsd)
    return 'At least $1,000 reported pool liquidity is required for shortlist placement.';
  if (c.group === 'excluded' || c.risk.status === 'excluded') return 'This chart has failed screening checks. Its history and feedback remain available.';
  return null;
}
export function shortlistStage(c: CandidateRow, now = Date.now()): ShortlistStage | null {
  if (c.manualStage && Object.hasOwn(SHORTLIST_STAGES,c.manualStage.stage))
    return manualStageBlock(c,now) ? null : c.manualStage.stage;
  return automaticShortlistStage(c,now);
}
