import type { Pool, TokenPoolContext } from '../shared/types.ts';
import { inScope } from '../shared/scope.ts';
import { knownLowLiquidity } from '../shared/liquidity.ts';

export function comparePools(mint:string,pools:Pool[],now:number):TokenPoolContext {
  const same=pools.filter(p=>p.mint===mint);
  const eligible=same.filter(p=>inScope(p)&&p.metricsAt!==null&&p.metricsAt<=now&&now-p.metricsAt<=120_000
    &&p.liquidity!==null&&Number.isFinite(p.liquidity)&&p.liquidity>=1000&&!knownLowLiquidity(p,now))
    .sort((a,b)=>(b.liquidity??0)-(a.liquidity??0)||a.address.localeCompare(b.address));
  return {mint,preferredPool:eligible[0]?.address??null,checkedAt:now,source:'DEX Screener token-pair lookup',
    reason:eligible.length?'Highest reported liquidity among matching PumpSwap/Raydium pools above $1,000. Origin and safety are checked separately.':'No matching PumpSwap/Raydium pool with verified recent liquidity of at least $1,000 was found.',
    pools:same.map(p=>({address:p.address,venue:p.venue,route:p.route,liquidity:p.liquidity,createdAt:p.createdAt,observedAt:p.observedAt}))};
}
