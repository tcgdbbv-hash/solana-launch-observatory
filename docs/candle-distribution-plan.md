# Snapshot screening and candle distribution plan

Status: scheduling phase implemented as a reversible trial, 28 September 2026. The user authorised implementation after reviewing this plan. See [operation and rollback](candle-scheduling-rollback.md). Provider diversification remains proposed; no credentials or subscriptions have been added.

## Purpose and constraints

Increase the number of distinct PumpSwap and Raydium charts assessed in time to identify a settled sideways or gently rising base. Keep the primary workflow quiet. Preserve the existing formation rules, supply/control/liquidity checks, saved feedback, alerts and manual selections. Market-cap bands remain preferences and classifications, not new discovery exclusions. A prior failure to match must not permanently eliminate a chart; a later quiet base must be able to qualify without another volume spike.

The approved infrastructure budget remains $0–$25/month. No paid product is included in the initial rollout. Multiple access paths must not be presented as independent data providers when they share the same underlying indexer.

The first improvement is to reduce unnecessary candle demand using the batched observations already collected. Extra candle providers support the remaining work; they are not the first-stage screening mechanism. This changes scheduling, not what counts as a confirmed formation.

## Current implementation and bottleneck

- GeckoTerminal supplies indexed discovery, 5-minute detector candles, older chart history, and the 1-minute chart while viewed. These jobs share one provider budget.
- The configured local maximum is 24 requests/minute with 2.5-second minimum spacing. Current public documentation describes approximately 10 requests/minute, variable with traffic.
- DEX Screener already batches activity for up to 30 pools: USD price, market cap, liquidity, five-minute/hourly volume, five-minute buy/sell counts and price change. These observations currently update metrics and range state; they are not yet a dedicated historical screen for deciding which charts deserve candles.
- Snapshot rows are currently written when values change; every successful metrics check is audited, including unchanged results. A new screening series must retain successful observation coverage and gaps, rather than treating irregularly saved rows as evenly spaced samples. DEX observations have a local retrieval time but no supplied source timestamp in the current adapter.
- SQLite already saves candles and audit revisions. The inspection found approximately 154,000 five-minute bars across 561 pools; caching is already present. We need better scheduling and reuse, not a second copy of the same cache.
- Current candle tables are keyed by pool and time. Blindly inserting a different provider would overwrite previous bars and could mix incompatible series.
- The observed live queue has hundreds of pools awaiting candles/refreshes. That number counts pools, not necessarily distinct coins.
- No configured keys were found under the proposed CoinGecko, Birdeye, Moralis or CoinMarketCap environment-variable names. No account access or keyed endpoint entitlement has been validated.

Read-only audit, 28 September at approximately 02:56 BST: the preceding hour contained 254 Gecko candle HTTP responses (211 successful and 43 HTTP 429), plus 10 indexed-discovery responses (8 successful and 2 HTTP 429). Error audit entries repeat the failed requests and are not additional requests. The stored operation omits query parameters, so this audit cannot reliably separate five-minute refresh, one-minute view and historical-backfill traffic. These figures are a baseline observation, not a forecast of sustainable capacity.

The current scheduler frequently revisits candidates merely because they are unreviewed, followed or pinned. Those states are not by themselves evidence of a developing base. One-minute viewing is checked before normal chart work, explicit refresh requests can jump the queue, and history work runs separately against the same provider budget. The replacement must account for all these consumers together.

## Provider allocation

| Connection | Initial role | Access and limits | Admission to live use |
|---|---|---|---|
| GeckoTerminal public | Most background candle collection; existing discovery and bounded backfill | Keyless; start at a proposed 8 total requests/minute, evenly spaced, with adaptive reductions and Retry-After | Already used; tune through measured tests |
| CoinGecko Demo | Small reserve for overdue promising bases, first assessments, and explicit chart requests | Free key; published 10,000 monthly calls and 100/minute maximum. Pool OHLCV is documented. Use a much smaller application budget | Require configured key, successful access tests, observed quota accounting and confirmation that parallel use adds usable capacity |
| Solana Tracker / Vybe / Dexploit | Candidates for a small independent candle allocation | Published free offerings identified in follow-up research; coverage, endpoint entitlement, sustainable allowance and data quality still require testing | No capacity counted until authenticated access where required and exact-pool comparison succeed; Dexploit's monthly allowance remains unclear |
| Birdeye | Candidate independent provider for a defined subset of pools | Advertised Lite $39/month and 2.5M compute units; outside current budget. Exact pair endpoint access and cost must be validated | Optional later phase only; requires budget decision and successful same-pool comparison |
| CoinMarketCap | Investigation only | Previous keyless Martians-pool test returned HTTP 403: historical DEX data unavailable on that access path | Do not allocate traffic or count capacity until a legitimate entitled request succeeds |
| Moralis | Investigation only | Solana pair OHLC endpoint is documented; current account entitlement and free capacity remain unverified | Do not assume old free-tier claims or count untested capacity |
| DEX Screener | Main inexpensive observation stage: batched snapshots, historical stability/activity features, pool identity and candle scheduling | Existing budget and batching; pool lookups share that budget | Add the snapshot screen in comparison mode first; sampled observations cannot substitute for full candle highs/lows/volume |
| Solana RPC / launch records / Jupiter | Controls, issuance, LP evidence and trade quotes respectively | Existing separate queues | Keep these separate from candle collection |

GeckoTerminal and CoinGecko are access paths to the same underlying on-chain dataset. Their combination is a bounded capacity improvement, not independent outage protection or independent confirmation. Real provider diversification requires an additional validated indexer such as Birdeye. The plan must report this honestly.

For CoinGecko Demo, propose an initial application ceiling of 9,000 monthly calls, leaving 1,000 for unexpected usage, access tests and accounting differences. Budget against the provider's actual reset period and remaining account credits, including any other use of the key. Pace roughly 290–300 calls/day over a normal billing month, allow bounded urgent bursts, and count retries and validation work conservatively. Stop before exhausting the allowance; never enable paid overages. This reserve cannot continuously refresh dozens of charts.

## Cheap observation before full charts

The proposed flow is **discover → observe cheaply → prioritise a chart check → confirm the formation and required checks → shortlist**. Keep preliminary observations in the background. A high screening score is a reason to fetch candles, not a recommendation or a verified base.

Build a timestamped observation history for each exact pool and token orientation. Use price for shape and market cap for the user's range preference; do not let a provider's supply/valuation revision masquerade as a price move. Record coverage, source and missing observations. Retain evidence when selecting a different primary pool, but never splice two pools into one apparent rise or consolidation.

Evaluate several elapsed-time windows so a rise over hours and a base developing over days both remain visible. Candidate scheduling features are:

- A meaningful earlier price rise and subsequent retreat when these have actually been observed or already confirmed in cached candles.
- Smaller recent price swings relative to the coin's own earlier swings, with range contraction over comparable windows.
- A sideways or gently rising path with small deviations around that path. Measure tightness around the trend as well as the overall range, so an orderly rising base is not rejected just because its endpoints are farther apart.
- Quieter activity relative to that coin's own history, alongside continuing trades and usable liquidity. Quiet is not automatically dead, and busy is not automatically promising.
- Stability of reported liquidity, usable data coverage and time since the last full assessment.

Do not introduce a universal minimum dollar volume or require another volume spike. Market cap between $30k and $250k remains a preference, with the established handling of coins outside that band. These features determine priority and revisit timing; candle confirmation and existing safety requirements still control shortlist admission. Cheap existing hard exclusions can run before expensive chart work.

Important measurement limits:

- Sampled prices miss intraminute highs/lows and cannot recreate true OHLCV. They only suggest that a chart deserves inspection.
- Rolling five-minute volume observations overlap. Never sum them into session volume or treat their differences as cumulative trade totals. Compare like-duration windows and use time-aware sampling; volume is supporting evidence.
- An unchanged response does not establish fresh trading or a perfectly flat base. Preserve successful poll timestamps separately from changed values, detect gaps, and treat uncertain freshness/activity as unknown. Do not fabricate earlier observations from the first saved sample.
- Irregular observations must be evaluated using elapsed time and coverage, not a fixed number of stored rows. A sparse series must not appear more established than a well-observed one.

Protect three routes around the cheap screen: a bounded first chart assessment for newly discovered pools, a first look at older coins with no locally observed launch history, and scheduled checks of quiet or previously nonmatching charts. Martians illustrates why observing the pump live cannot be mandatory. Missing history lowers confidence, not permanent eligibility. A reserved rotating sample of low-priority charts measures what the cheap screen would miss, without rechecking every coin equally often.

Once candles confirm a promising or qualified base, keep it on the timely refresh path. Do not require it to pass the cheap screen again on every cycle, especially after a data gap. A prior match earns refresh priority but cannot remain displayed as currently qualified on stale evidence.

For scale only: 500 pools at 30 per snapshot request need 17 batched requests for one complete observation pass. Those requests share the DEX budget with lookups and retries. If 20 charts then need five-minute candle refreshes, that portion is four requests/minute, plus first looks, background checks, history and UI demand. This is illustrative arithmetic, not an expected selection rate or measured saving. Pilot results must determine the actual attention split.

## One persistent work queue

Create a candle service that owns all discovery-related chart work, background refreshes, detail-panel requests and history backfill. The UI reads saved data and can request work; it does not create an independent polling path.

Each job records network, exact pool, requested token mint, currency, interval, needed time range, reason, priority, due time, last attempt and provider assignment. Equivalent queued or in-flight work is coalesced. Overlapping requests can share a response when its coverage is sufficient. A successful HTTP request with old or empty data does not reset the chart's freshness.

Maintain separate request-minute and billing-period balances for each provider and account. Persist consumption, cooldown and retry state across restart. Also represent shared provider-family constraints where observed; do not assume different keys or hostnames provide independent allowances. On 429, honor Retry-After, reduce pace and defer work. On 401/403, stop that route and disclose the access problem rather than retrying repeatedly. Network/5xx retries are bounded and use backoff. Failure of one adapter must not block other eligible jobs.

Assign each pool/interval a preferred source, with a minimum assignment lifetime. Allocate new assignments by verified coverage, spare budget and measured response quality. Do not rotate sources for every candle or request. Use another source only for a genuine coverage/availability need and after comparison rules pass.

## Which charts receive attention

The proposed spending policy reserves discovery overhead and obeys provider cooldowns first. Divide the remaining candle-request opportunities using the following initial weights. These are shares of the actual available request budget, not additional allowances or promises of successful responses:

| Request purpose | Initial share | What earns the request |
|---|---|---|
| Confirm or maintain a promising base | 50% | Snapshot history suggests settling, the last candle assessment is close to qualifying, or a recent qualified base needs fresh evidence |
| First chart assessments | 20% | A not-yet-assessed primary pool has useful elapsed history; balance promising cheap observations with older-due pools whose history is unknown |
| Rediscover developing quiet charts | 20% | Periodic reassessment of previously nonmatching charts, including a reserved rotating sample independent of the cheap score |
| Resolve specific missing evidence / viewed charts | 10% | A bounded historical page that can answer a current assessment question, or an actual user request for a one-minute chart |

Use weighted fair scheduling over multiple requests, not rigid per-minute partitions. Borrow unused capacity when a class has no eligible work; when it becomes active again, restore its share without a catch-up burst. Requests that fail still consume their class's allowance and enter backoff. Retries must not consume the first-look and quiet-chart reserves on behalf of hot charts. Discovery, connection validation and comparison probes must also be charged explicitly; none run outside the total provider limit.

Within each class, combine evidence of a settling structure with time overdue and missing information. Following or pinning expresses user interest but does not grant unlimited priority. A single coin must not repeatedly jump ahead just because it already has a saved pump match. Explicit refreshes join the shared queue, reuse sufficient cached results and coalesce repeated clicks.

Before spending a candle request, require a recorded answer to all of these:

1. **Which question will it answer?** First history, possible base confirmation, maintaining a current base, periodic reassessment, or an identified history gap/view request.
2. **Could new useful evidence exist?** Wait for the relevant candle close plus provider settlement delay. A normal refresh should not download the same closed window repeatedly; a first fetch or specific backfill can legitimately request older bars.
3. **Do we already have it?** Check cached coverage and equivalent queued/in-flight requests before using the provider.
4. **Is this the right pool?** Prefer the selected primary PumpSwap/Raydium pool per token. A second pool gets candle work only for an explicit comparison or coverage need, not merely because discovery also found it.
5. **Is its budget and retry time available?** All paths, including UI views, honor the same accounting and cooldowns.

A normal five-minute refresh is at most one successful collection for each new completed interval when the provider has caught up. An empty or stale response earns bounded delayed retries, not immediate repolling. Known hard exclusions and explicit archives remain excluded under existing rules; missing evidence is not a hard rejection.

These are initial scheduling targets within those shares, not promised latency or detector changes:

| Work class | Intended scheduling |
|---|---|
| Shortlisted, promising forming bases and active manual reviews | Latest completed five-minute bar; target each new close plus provider settlement delay |
| Earlier rise/pullback, developing but not yet settled | Approximately 15–30 minutes, adjusted to available capacity |
| Unseen charts | Reserved first-look turns; expensive requests are deferred until sufficient closed bars can exist |
| Quiet or previously nonmatching charts | Periodic 1–3 hour reassessment initially, adjusted by queue size; no new spike required |
| Earlier history | Bounded work when missing history prevents a meaningful assessment |
| Viewed one-minute chart | Cached display; at most one request/minute for the active chart, within a shared small allowance |

The proposed 20% first-look and 20% quiet-reassessment shares together preserve more than the earlier one-third background reservation. Aging priority and per-chart request ceilings prevent a few followed charts or repeated clicks from consuming every turn. When demand exceeds capacity, show the actual overdue work and adjust schedules; do not claim every chart receives its target interval.

The snapshot screen above moves charts between these attention classes using their developing history. Every retained background chart keeps a scheduled reassessment route, with intervals allowed to stretch under load. A stale prior match can regain refresh priority without being displayed as currently qualified.

At 8 total requests/minute, the theoretical ceiling is 480 requests/hour before failures and all non-candle overhead. Actual observed capacity may be substantially lower, as the baseline above shows. Calculate the weighted shares from available capacity after that overhead, and measure completed useful assessments rather than assuming the configured ceiling is delivered. Background reassessment must remain selective: cheap observations continue across the retained population while full chart checks rotate. If the important set grows or 429s continue, targets must stretch or capacity must increase.

## Request accounting and pilot decision

Persist each job's purpose, queue class, exact pool/mint, timeframe, requested coverage, enqueue/due time, priority reasons and policy version. Record attempts with HTTP outcome, wait time, returned coverage, number of new or revised closed bars, and whether the assessment changed. Keep the scheduling reason separate from formation or safety status. An unchanged chart can still be a useful confirmation; it is not automatically a wasted request.

The pilot report should show request share by purpose, distinct tokens first assessed, age of promising charts, background wait, duplicate fetches avoided, empty/stale responses, rate limits and sampled formations the cheap screen missed or found late. Reserve quiet-chart sampling before measuring misses; evaluating only the high-scoring group would hide false negatives. Review these together before changing the initial 50/20/20/10 split. Do not tune allocation solely to the later returns of the winning examples.

## Candle compatibility and saved evidence

Add an append-only provider observation layer before enabling another indexer. Preserve existing canonical candles, original audit evidence and frozen feedback snapshots. Store the access connection and underlying data family separately.

Validate exact pool identity, token orientation, USD versus quote units, volume units, UTC interval boundaries, closed-candle status, duplicate rows, gaps, finite positive prices and OHLC consistency. Native or stock-paired candles must not be treated as USD merely by their shape. Token-wide aggregated candles cannot silently replace selected-pool candles.

Retain source, retrieval time, candle timestamps, response coverage, request identifier and adapter version. Maintain a deterministic canonical selection policy; record every source change with its reason. Do not sum volume from two providers for the same pool/bar or overwrite a complete observed candle with an empty/partial one. Current-table migration requires a consistent SQLite backup and a rollback path.

Compare an overlapping window before failover or promotion. Use sufficient recent closed bars to cover the intended assessment where available. Compare timestamps and gap coverage, median and tail price differences, volume scale, and detector outcomes. Exact identity or unit mismatch blocks promotion. Material unexplained differences keep the incoming series isolated for review. Start with conservative diagnostic tolerances, then fix final tolerances from the comparison report before automatic switching; a tiny low-liquidity chart need not match a high-liquidity chart's noise profile.

Reduce refresh response size with a small overlap where the endpoint supports it; use explicit backfill for older gaps. This reduces bytes and processing, not the number of quota credits for a request. Reuse sufficient complete 1-minute coverage for larger display intervals only after validating aggregation semantics; otherwise keep the existing five-minute detector series separate.

## Validation and rollout sequence

1. **Baseline:** save a consistent database backup; measure distinct pools first-assessed/refreshed per hour, data age, queue wait by class, request success, 429 rate and quota consumption. Use observed data, not the headline API rate, for forecasts.
2. **Snapshot screen in comparison mode:** preserve observation coverage and compute scheduling features without suppressing current checks. Compare suggested priority against later candle assessments, including a reserved sample of low-ranked charts. Measure missed formations and qualification delay, not just request savings. Historical examples without contemporaneous snapshot coverage cannot validate this stage; test those with available evidence and collect prospective data.
3. **Scheduler rollout:** implement shared jobs, duplicate suppression, persistent budgets and fair background allocation behind a reversible flag. Test restart, exhausted quota, stale responses, repeated clicks and provider cooldowns. Test Gecko pacing independently. Enable snapshot-based scheduling for a small cohort only after miss-rate review; retain first-look and periodic reassessment routes.
4. **Provider access pilot:** validate the free candidates and CoinGecko Demo using a small mixture of PumpSwap, Raydium, MG/stock-paired and low-activity pools. Obtain/configure keys through normal account flows where required. Account for comparison requests. No key goes into browser code, logs or chat; unverified allowances do not count as capacity.
5. **Candle comparison-only run:** save incoming provider data separately and run the same detector without publishing its results. Include Martians and OP pre-breakout windows, MG's shorter pause, Swarm, quiet nonmatches, volatile launches and incomplete histories. Use only evidence available at each replay cutoff. Successful examples do not set new detector thresholds by themselves.
6. **Small live provider subset:** route a bounded cohort through a validated connection, retain the rest on GeckoTerminal, and compare useful fresh coverage per request against baseline. Ramp only after compatibility, budget and fairness checks pass. Fallback must preserve existing alert deduplication and never announce a base merely because a provider changed. Paid providers remain outside the initial rollout.

Acceptance requires: one external fetch per equivalent in-flight job; no quota reset on app restart; no polling a provider through its cooldown; continued background service under heavy Following/UI demand; preserved historical evidence and selections; no false base created by source splicing; no duplicate alert after failover; and measurable improvement in distinct fresh chart coverage rather than just request count. Report the snapshot screen's sampled missed formations and detection delay alongside request savings. If provider access remains unavailable, report single-provider operation explicitly.

## UI changes in scope

Keep the chart workspace calm. Show actual candle freshness and a concise delay notice when relevant. Place per-provider status, quota remaining, next retry, oldest wait and coverage by queue class under Research & settings. Distinguish app sync, market-data time and latest closed-candle time. Do not add source-switch notifications to normal Updates.

## Open dependencies before implementation

- A CoinGecko Demo key must be obtained/configured by the user through the provider's normal account flow. No account creation or credentials were performed during planning.
- Two simultaneously usable Gecko-family connections must be tested; published request rates alone do not prove additive throughput from this machine.
- No independent free candle source is yet verified for this scanner's pool set. Birdeye is a candidate beyond the current budget, not an already purchased or tested service.
- Final comparison tolerances and actual refresh capacities will come from the bounded pilot. The existing five-minute detector cannot promise a sub-minute response to a formation before its candles close.

## Sources checked

- [DEX Screener API reference](https://docs.dexscreener.com/api/reference): pool price, liquidity, activity and volume snapshots; current batching is confirmed in the collector.
- [Solana Tracker Data API](https://www.solanatracker.io/data-api), [Vybe plans](https://docs.vybenetwork.com/docs/plans-rate-limits) and [Dexploit pricing](https://dexploit.dev/pricing): additional published access options; not yet verified integrations.
- [GeckoTerminal current public API documentation](https://api.geckoterminal.com/docs/index.html): keyless access, approximate variable rate and candle endpoints.
- [CoinGecko Demo pool OHLCV](https://docs.coingecko.com/demo/reference/pool-ohlcv-contract-address): pool-specific candles, token orientation, intervals and units.
- [CoinGecko plans](https://www.coingecko.com/en/api/pricing): Demo monthly allowance and rate, paid alternatives.
- [CoinGecko key/IP rate example](https://support.coingecko.com/hc/en-us/articles/23189120457497-What-is-the-rate-limit-for-the-paid-CoinGecko-API): extra keys on one IP do not automatically multiply the documented limit.
- [Birdeye current pricing](https://birdeye.so/data-api/pricing): Lite price and included compute units; exact endpoint entitlement remains a pilot gate.
- [Moralis Solana pair OHLC](https://docs.moralis.com/data-api/solana/price/ohlc): documented endpoint, not evidence of this user's entitlement or free capacity.
- [CoinMarketCap OHLCV documentation](https://coinmarketcap.com/api/documentation/pro-api-reference/ohlcv): documented access path; actual preceding live test returned 403 for historical DEX access.
