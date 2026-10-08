import type { Pool } from '../shared/types.ts';
import type { Store } from '../server/store.ts';
import { pendingProtection } from '../server/liquidity.ts';
// Synthetic evidence is used only in isolated unit-test databases.
export function approveScopeChecks(store:Store,pool:Pool,now:number) {
  store.saveSupplyOrigin({mint:pool.mint,raw:'1000000000000000',decimals:6,signature:'fixture',slot:1,checkedAt:now,source:'isolated test fixture'});
  store.saveProtection({...pendingProtection(pool),status:'passed',checkedAt:now,burnedPercent:100,lockedPercent:0,reasons:['isolated test fixture']});
}
