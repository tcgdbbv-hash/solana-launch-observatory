import type { CandidateRow, TradingProgress } from './types.ts';

export function tradingProgressLabel(progress?: TradingProgress): string {
  if(!progress)return 'Trading check needed';
  return {
    current:'Quotes current', waiting_setup:'Trading check deferred', waiting_controls:'Waiting for token controls',
    waiting_liquidity:'Waiting for liquidity check', queued:'Trading check queued', checking:'Checking buy / sell quotes',
    retry_wait:'Trading retry scheduled', rate_limited:'Trading check delayed', paused:'Trading checks paused', inactive:'Trading checks inactive',
  }[progress.state];
}

export function checksLabel(c: CandidateRow) {
  if(c.archived)return c.researchTags?.includes('not_matching')?'Archived · Not my setup':'Archived';
  if(c.group==='excluded') {
    if(c.risk.controls.status==='excluded')return 'Token controls failed';
    if(c.risk.supply?.status==='excluded')return 'Supply outside scope';
    if(c.risk.liquidityProtection?.status==='excluded')return 'Liquidity protection failed';
    return c.risk.trading.status==='excluded'?'Trading costs above limits':'Checks failed';
  }
  if(c.group==='pending') {
    if(c.risk.controls.status!=='passed')return 'Token controls pending';
    if(c.risk.supply?.status==='pending')return 'Initial supply pending';
    if(c.risk.liquidityProtection?.status==='pending')return c.risk.liquidityProtection.checkedAt?'LP recheck pending':'LP check pending';
    return c.tradingProgress?.state==='current'?'Checks pending':tradingProgressLabel(c.tradingProgress);
  }
  return c.risk.status==='passed'?'Checks passed':c.risk.manualReview?.approved?'Reviewed by you':'Checks pending';
}
