import type { CandidateRow, Group } from './types.ts';
import { inScope } from './scope.ts';
import { knownLowLiquidity } from './liquidity.ts';
import { freshReportedCap } from './ranges.ts';
import { priceWithinBase } from './base.ts';
import { extremeDrawdown } from './drawdown.ts';

export const RESEARCH_TAGS = {
  watching_base: { label: 'Watching for a base', help: 'Follow the coin to see whether a supported sideways or gently rising range develops after its initial pump and pullback.' },
  base_forming: { label: 'Base forming', help: 'You see early signs of a supported sideways or gently rising range. It still needs time and repeated tests.' },
  base_established: { label: 'Base established', help: 'In your judgment, a sideways or gently rising range has held across repeated tests.' },
  revisit: { label: 'Revisit later', help: 'Keep this coin in your selections so you can assess it again later.' },
  not_matching: { label: 'Not my setup', help: 'Archive this coin and remove it from your watchlist. Its chart history and your feedback remain available in Not my setup and Archived.' },
} as const;
export type ResearchTag = keyof typeof RESEARCH_TAGS;
export type WatchlistFilter = Group | ResearchTag | 'all' | 'within' | 'manual';
export const eligibleCandidate = (c: CandidateRow) => ['new', 'watching', 'above', 'below'].includes(c.group);
export function shortlisted(c: CandidateRow, now = Date.now()) {
  return !c.archived && !c.researchTags?.includes('not_matching') && inScope(c.poolData)
    && !knownLowLiquidity(c.poolData, now) && !extremeDrawdown(c.drawdown) && freshReportedCap(c.poolData,now) && eligibleCandidate(c) && priceWithinBase(c.base,c.poolData,now);
}
export function inResearchWatchlist(c: CandidateRow, now = Date.now()) {
  return !c.archived && !c.researchTags?.includes('not_matching') && inScope(c.poolData) && !knownLowLiquidity(c.poolData, now)
    && (shortlisted(c, now) || !!c.shortlistedAt || c.manualWatch === true);
}
export function awaitingChecksInRange(c: CandidateRow, now = Date.now()) {
  return c.group==='pending'&&!c.archived&&!c.researchTags?.includes('not_matching')&&inScope(c.poolData)&&!knownLowLiquidity(c.poolData,now)
    &&!inResearchWatchlist(c,now)&&c.capRange==='within'&&freshReportedCap(c.poolData,now);
}
export function matchesWatchlist(c: CandidateRow, filter: WatchlistFilter, now = Date.now()) {
  // Eligibility and numeric range are independent of the user's tracking tags.
  if (['pending', 'excluded', 'archived', 'parked'].includes(filter)) return c.group === filter;
  if (filter === 'not_matching') return c.researchTags?.includes('not_matching') ?? false;
  if (!inResearchWatchlist(c, now)) return false;
  if (filter === 'all') return true;
  if (filter === 'manual') return c.manualWatch === true;
  if (filter === 'watching') return c.researchTags?.includes('watching_base') || c.group === 'watching';
  if (Object.hasOwn(RESEARCH_TAGS, filter)) return c.researchTags?.includes(filter as ResearchTag) ?? false;
  if (['within', 'above', 'below'].includes(filter)) return c.capRange === filter;
  return c.group === filter;
}
