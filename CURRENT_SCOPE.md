# Current user amendments — 2026-09-27

The scanner remains a real-data, low-cost local pilot. It detects an initial pump with volume, preserves the original evidence and supports manual assessment of a possible later base. No two-day expiry, automatic deletion, automatic trading or automated model training is added.

## Manual tracking and independent tags

- The watchlist now combines eligible detections and explicit manual research selections. Selecting a pending coin means following its chart; its screening group, mandatory checks and trading override are unchanged. This supersedes earlier wording that every visible watchlist entry had passed its checks. Pending/failed statuses remain visible and independently filterable.
- In a detected coin's **Your tracking** panel, **Add to my watchlist** follows it without requiring a risk approval. **Save tags & follow** saves multiple labels: Watching for a base, Base forming, Base established, Revisit later, Not my setup.
- Market-cap range is automatic and independent. One mint can simultaneously be manually selected, watching for a base, in $30k–$250k and checks pending. Tags survive range movements, restarts and changes of primary pool. **My selections** and tag filters provide overlapping views without duplicate candidate records.
- The hard $1,000 liquidity floor, archived state and paused Meteora scope still suppress research watchlist membership. Saved selections/tags remain as history; selecting/tagging does not bypass these rules.
- Tag/selection changes log the previous and new human choices with as-of pool, cap, checks, settings, episodes and closed-candle evidence. Feedback snapshots include those choices. They are preferences/judgments, never automated safety verification or confirmed accumulation labels.
- **Launch Observatory.command** in the project root provides double-click startup on macOS, using installed Node.js 24.10+. It prepares the app, reuses an already-running instance, opens the browser and shuts down its collector when its Terminal session stops.

**Not my setup now archives by default.** Saving this tag clears manual watchlist selection, removes the coin from active research/range views, and stops new range notifications. Its tag/history remain under Not my setup and Archived. Existing user tags are applied once with a policy audit. Restoring explicitly clears the rejection tag and preserves other tags and earlier feedback; screening results remain independent.

## Venue, identity and liquidity selection

- PumpSwap and Raydium are the active chart venues. DAMM collection is paused. Existing Meteora history, reviews and logs remain.
- Meteora DLMM discovery is retained **as context**. A new DLMM triggers an exact-mint DEX Screener pool lookup, selects the largest reported-liquidity PumpSwap/Raydium pool meeting the $1,000 floor, and queues its own candles. Names/symbols are not identity.
- The selected pool's venue/address, candles, token price, reported market cap and total pool liquidity stay together. Liquidity appears between price and cap. Explicit secondary-pool inspection stays possible. No cross-pool candle splicing or summing liquidity into the displayed primary figure.
- DLMM addresses, liquidity, first observation and provider creation times remain linked. “Added later” is shown only where both creation times establish that order. This does not prove the token originated on that venue, shared ownership, accumulation, safety or profitable price action.
- The lookup currently uses correctly priced base-mint pairs; a token appearing only on the quote side does not get another token's price/cap substituted. Public index coverage and primary selection remain partial, timestamped observations. Recomparison on chart opening/refresh can update the preferred pool. No historical signal is attributed to a new primary pool until that pool produces its own detector match; old episodes and reviews stay attached.

## Supply

- “1 billion” means **tokens**, not USD market cap. No assertion about 98% market prevalence is used as evidence.
- Current finalized mint supply above 1 billion, zero supply, or verified initial issuance different from 1 billion excludes the token. Raw integers and decimals are compared exactly.
- A lower current supply is acceptable with verified 1-billion initial issuance; current supply of 1 billion alone is not proof of starting supply.
- A finalized transaction must show this mint's initialization and parsed canonical token-program issuance. Missing/failed/unparsed history, mismatched mint/decimals or split issuance that cannot be established remain pending. The first version searches up to 20 signature pages, then inspects up to 12 oldest available transactions; cursors/retries persist. The UI accepts a creation transaction signature for read-only verification, not manual approval.
- This strict evidence requirement can withhold otherwise legitimate tokens on free RPC history. User-approved manual trading inclusion, including MG, remains recorded but cannot bypass it.

## Liquidity protection

- Verified burned or permanently locked LP passes the liquidity-protection check for the actual pool, including PumpSwap graduations and LaunchLab CPMM migrations. The UI shows **LP protected · burn / lock verified** independently of other pending checks. A venue label alone is not graduation or protection proof; no blanket “safe token” status is inferred.
- Fixed a PumpSwap adapter error: its LP mint uses **Token-2022**, while Raydium CPMM uses the **legacy SPL Token program**. The old adapter required legacy ownership for both and incorrectly withheld genuine burned PumpSwap LP. Version 2 rechecks stored evidence and validates the expected program, plain LP mint layout, authority and live supply. Other token-control checks stay independent.
- Below **$1,000 USD-equivalent total pool liquidity** is a mandatory exclusion. Such pools are removed from normal chart screening, quote prioritization and range alerts, with retained records under Ignored liquidity. A slow hourly metric check can notice recovery. A recovered pool must still pass all other checks.
- The previous $10,000 sample-trading screen remains an additional default; manual trading review may override that default, but never the $1,000 floor.
- Unknown lock/burn protection stays pending as explicitly requested. The conservative v1 gate requires all recorded LP rights to be accounted for as burned/non-redeemable or held by a recognized permanent lock authority. Partial protection is shown numerically and withheld.
- The adapters validate pool program/discriminator, exact base/quote mints, LP mint and authorities, then read pool and LP accounts in one finalized account snapshot. PumpSwap and Raydium CPMM LP-supply accounting supports burned/non-redeemable-rights comparison. Raydium CPMM custody at the official Burn & Earn lock authority is counted only for matching initialized LP accounts without a delegate.
- Raydium AMM v4, CLMM positions, other lockers and unknown layouts remain pending until supported; shared-program upgradeability and new deposits remain relevant limitations. A lock/burn observation does not prevent swaps from draining value or a price collapse. No rug-proof or trading-safety guarantee is made.

## Charts, ranges and feedback

- A separate genuine **1m** series is fetched while viewed, at approximately one request per minute within the shared public-feed budget. It is not reconstructed from 5m candles. Detection still uses the original 5m rules. Missing intervals, delayed sources and limited recent history stay visible.
- Token price / market-cap switching changes display units only. Estimated historical cap = candle price × latest reported cap/price ratio. Historical supply changes are not verified; FDV cannot substitute. USD volume does not change.
- Stable per-pool `CH-…` IDs and persistent `AL-…` notification IDs. Range badges: `A250` above $250k, `R30-250` $30k–$250k inclusive, `B30` below $30k, `UNK` unverified. Re-entry automatically restores the range grouping while preserving pin/review state. Stale, future, FDV-only or out-of-order data does not cause transitions. Initial observations above/below are labeled honestly. Alerts are in-app; the local server/computer must be running.
- **Notifications** replaces the less discoverable Range alerts label, with a top-bar bell/unread count, coin name and symbol in popups/banner/history, All/Unread views and persistent read state. Entries retain token address, venue, cap, time and chart/alert IDs. Opening an alert selects its exact historical pool. The banner uses the latest unread alert even when newer alerts have already been read.
- First sightings already above $250k are no longer range notifications. Older such records remain stored/audited but are omitted from Notifications and unread counts. Actual crossings and re-entries still notify; the original pump may still peak above $250k and detector evidence is retained.
- Below-range notifications/badges are yellow at $20k–below $30k, orange at $10k–below $20k and red below $10k. At $30k the coin is in range. Colours describe observed cap, not verified safety.
- In-range research has separate **Tracked** and **Awaiting checks** sections. Additional pending detections with fresh reported caps are discoverable there without approval or automatic watchlist inclusion. Hard liquidity, venue and archived-state restrictions persist, and failed-check coins remain in Excluded.
- A **base** is a possible sideways range after the pump/pullback, with repeated holds of lows and an upper boundary. It is a chart observation, not proof of accumulation. The preferred market-cap band is location, not the definition of a base.
- “Initial pump still developing” is separate from “Not enough post-pump history” (the former “Too early”). Every formation/base/scope/reason choice has inline help and a full answer glossary.
- Reviews freeze available 5m/1m candles, original episode, pool comparison, controls, supply, LP protection and quote evidence at review time. Later reviews append rather than rewrite. Automated evidence and human judgments remain distinct. In particular, unknown lock status is not labeled as a confirmed liquidity pull. Logs and exports form inputs for a future AI layer; they do not currently retrain a model or change thresholds automatically.

## Primary implementation references

- [Solana mint account: supply, decimals and authority](https://solana.com/docs/tokens/basics/create-mint), [signature history](https://solana.com/docs/rpc/http/getsignaturesforaddress).
- [PumpSwap account and LP accounting documentation](https://github.com/pump-fun/pump-public-docs/blob/main/docs/PUMP_SWAP_README.md), [official IDL](https://github.com/pump-fun/pump-public-docs/blob/main/idl/pump_amm.json).
- [Raydium CPMM pool layout](https://github.com/raydium-io/raydium-sdk-V2/blob/master/src/raydium/cpmm/layout.ts), [official program and lock-authority addresses](https://github.com/raydium-io/raydium-sdk-V2/blob/master/src/common/programId.ts), [lock LP implementation](https://github.com/raydium-io/raydium-sdk-V2/blob/master/src/raydium/cpmm/cpmm.ts).
- [GeckoTerminal OHLCV and public API caveats](https://apiguide.geckoterminal.com/faq), [DEX Screener reference](https://docs.dexscreener.com/api/reference).
