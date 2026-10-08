# Observatory — Solana launch scanner

A working local first version of the agreed scanner. It discovers real pools, retrieves actual API candles, watches earlier price rises quietly, and surfaces active consolidations after a selloff for manual review. **There is no demo mode, seeded dashboard data, or simulated signal feed.** Unit-test fixtures exist only in isolated test databases.

## Run

Requires Node.js 24.10 or later. Node's built-in SQLite is experimental in the tested Node 24.10 runtime.

**On this Mac:** double-click **Observatory.app** in the project root. This opens **Launch Observatory.command** in Terminal, finds Node, installs project dependencies if missing, builds the latest app, starts the scanner, and opens your default browser when ready. Codex does not need to be open. Keep the launcher’s Terminal window open while scanning; press **Control-C** in that window to stop. You can close the browser and reopen the app without losing your saved data. The Mac must stay awake to collect data.

Keep **Observatory.app** inside the project folder; it is a local Mac launcher, not a self-contained distribution or Windows `.exe`. You can move the whole project folder together. It uses the existing database, settings and API configuration; no Codex runtime or paid hosting is needed. Node must already be installed (it is installed on this Mac).

Startup/build messages are also saved to `logs/launcher.log`. Readiness is checked through the small `/api/health` endpoint, without loading the entire chart database.

The launcher uses the port and data directory in `.env` if configured. If a scanner is already running, it opens that instance rather than starting another collector. That existing instance retains its original owner: stop an editor-started server first if you want to transfer it to Terminal. You can also double-click **Launch Observatory.command** directly or run `./"Launch Observatory.command"` from a terminal. If executable permissions are lost when copying the project, restore them with `chmod +x "Launch Observatory.command" "Observatory.app/Contents/MacOS/Observatory"`.

To start manually:

```sh
npm install
npm run build
npm start
```

Open **http://localhost:4310**. The server binds to `127.0.0.1` only. Your computer must remain awake and the process must remain running to collect data. This first version does not install a background system service or deploy to a paid host.

For development, use `npm run dev`. Optional settings are documented in `.env.example`; copy it to `.env` only if you need to change them. No account, wallet, API key or paid service is required for the implemented public-feed paths. Do not put wallet keys in this application.

The GitHub repository contains the source, launcher, documentation and test fixtures. Local scanner records, saved reviews, `.env`, backups, logs and generated test results are excluded. A fresh clone starts with a new database; publishing or updating the source does not move your existing scanner data. Keep local backups separately.

## What works

- Active chart discovery/monitoring: PumpSwap and Raydium. Meteora DLMM discovery is context only: resolve the exact mint to the deepest matching active-venue pool and retain DLMM creation timing and liquidity. DAMM collection is paused; historical records remain.
- A persistent pool registry, including pools that do not match the pattern. Activity snapshots include the actual reported volume window and retrieval time.
- Real one-minute OHLCV fetched on demand while a chart is viewed, with a shared free request budget. Five-minute detector candles remain separate; 15-minute, hourly and four-hour views require complete intervals. Token price / estimated market-cap display switch, with USD volume unchanged.
- A configurable detector for a sustained closing-price rise, active candles and elevated volume. Rising structures without a usable volume baseline are clearly provisional. A subsequent pullback changes the current formation stage.
- Original detector evidence, settings and detection timestamps saved per episode. A retrieved historical pattern is identified as a backfilled observation, not an alert the application supposedly sent earlier.
- Mandatory finalized token-control checks and read-only sample buy/sell quotes. Unknown checks are pending; failed checks are excluded, with reasons and evidence preserved.
- One candidate per mint, linked to separate pool histories. Shortlist, Following, Updates and Archive are the main destinations. Early observations and technical research sit under Research & settings. Stable chart/alert IDs, cap filters, tags, pinning, notes and archive/restore remain available.
- No age expiry. The initial evidence and continuing candles remain stored through a long consolidation or collapse. Below $30k changes grouping, and a fresh return to $30k–$250k restores the normal review grouping; above $250k remains tracked separately. Cap grouping does not confirm a base.
- Downloadable numerical evidence bundles for review with your existing AI assistant. This does not call a paid model automatically or claim that an AI has reviewed a coin.
- Persistent source cursors, migration-resolution queues, request counters, bounded retries and HTTP 429 cooldowns. Provider failures remain visible in Sources & coverage.
- A reversible candle balance reserves 35% of turns for first chart checks, 25% for Early signs refreshes, 20% for promising bases/hints, 15% for quiet revisits and 5% for history/views. Early signs target a refresh every ten minutes while the thirty-minute freshness rule remains unchanged. See results and **Restore earlier candle balance** in Sources & coverage; [operation and rollback](docs/candle-scheduling-rollback.md) describes limits and commands.

## Review workflow

1. **Shortlist** shows fresh active bases after an early rise and selloff, only when mandatory checks pass. A fresh pump or a cap-band crossing alone does not qualify. An empty shortlist is an honest result.
2. **Following** keeps manual selections and previously shortlisted setups visible across later changes. Pending/failed checks remain visible. Archive removes a coin from active views.
3. Open a chart for price, deepest selected-pool liquidity, market cap, chart tools and a compact checks notice. The base assessment sits below the chart; detailed checks, linked pools, original evidence and history expand on demand.
4. **Give feedback** opens tags and free-form notes. Structured questions are optional. Drafts survive closing/reopening the dialog and refreshing this browser tab. Saving tags/notes is one transaction with the as-of evidence log. A note is a human observation, not verified ownership information.
5. **Not my setup** archives the coin; other tags can overlap with cap ranges. Restore removes only the rejection tag. Follow controls and screening checks remain separate.
6. **Updates** contains newly qualified bases, changed bases and actual range crossings for manual follows or previously shortlisted charts. It shows one card per token with its latest event and expandable earlier updates; unread badges count coins. Reading a card acknowledges that coin's events through the displayed update, without clearing later arrivals. A base can requalify during the existing 24-hour notification cooldown, but only one loss alert is sent per announced qualification. There are no discovery popups. Previous discovery alerts and all grouping events remain in stored history/activity.

Cap remains a separate dimension: $30k–$250k is preferred, with no cap-based deletion. Below-range colours remain yellow ($20k–below $30k), orange ($10k–below $20k) and red (below $10k). Fresh re-entry restores the within-band grouping. Pool liquidity, token controls, supply and LP protection retain their independent policies.

## Current pattern assessment

- Price-rise windows: 15m, 30m, 1h, 2h, 3h, 4h and 6h. Volume is relative to the same coin's preceding closed candles, using at least three baseline bars. Default rise and volume ratios remain configurable. Missing baselines stay provisional; no universal dollar-volume minimum admits a pump.
- Quiet pools receive rotating chart coverage even without high dollar volume. Tracked charts receive two of every three available scheduled candle turns, with fresh qualifying bases and plausible active ranges checked first; the general oldest-due rotation receives the other turn. Priority ranges become due after each settled 5m close, retrying delayed candles no more than once a minute and avoiding duplicate requests once that close is stored. Explicit refresh and on-demand 1m requests share the same provider budget.
- Versioned base assessment evaluates 1h, 2h, 4h, 8h, 12h, 1d, 2d, 4d, 1w and 2w trailing windows. The coin continues to be monitored without age expiry.
- Initial hypotheses: central 80% closing-price band at most 30%, three separated floor tests, two ceiling tests, at least 85% candle coverage, at least 65% active candles and at least 20% retracement from the earlier closing peak. Sideways bases allow median drift up to 12% and 60% of width (3% tolerance). Rising bases instead measure their band and retests around a log-price slope against actual elapsed time. They require rising lower and upper bounds, repeated pullbacks, at least 5% fitted total gain, at most 8% fitted hourly gain, and a log slope at most 35% of the earlier pump's rate. A dominant single jump, inactivity, falling support, extreme wicks or closes outside the band prevent qualification. These are initial, unvalidated calibration cutoffs.
- Qualified rising bases receive 10 extra ranking points, and measured tightening adds 5. Longer persistence and narrower swings also add weight. The score describes review priority, not expected returns, ownership concentration, holder growth or holding duration.
- Tightness is separate from market-cap location and duration: tier 5 is at most 5% band width, 4 at most 10%, 3 at most 15%, 2 at most 25%, and 1 wider. Compression compares equal elapsed-time halves of the same assessment window, after accounting for a rising slope. A decrease of at least 20% and 1 percentage point means tightening; an increase of at least 25% and 1 point means widening. Missing coverage means unknown. Different assessment windows should not be compared as if they were the same time series. JSON assessment records retain the raw width, slope-adjusted width, fitted gain, direction, compression ratio, tier, priority increment and evidence.
- Launch proximity uses pool creation as an explicitly labelled proxy: the supported rise must start within six hours of that creation. Bonding-curve history before migration is not yet combined with the pool chart. This can miss valid patterns.
- Freshness is required for current shortlist admission. Candle revisions are re-evaluated even when the latest timestamp is unchanged. Admission and its notification happen within the evidence-saving transaction, as soon as a base, fresh price and all required checks agree; no later breakout or periodic sweep is needed. The latest reported price must still lie within the observed band (projected to the metric time for rising ranges), with the detector's 3% boundary tolerance. An earlier admitted base remains in Following and its saved evidence is retained after price leaves it.
- Activity, controls, supply, LP protection and quote queues give fresh bases priority. Each reserves every third served turn for oldest-due work; explicit supply-proof requests retain precedence. This changes queue order within existing free budgets, not screening requirements. Closed 5m candles, their 30-second settlement margin, provider indexing delays, rate limits, pending verification and the UI's 15-second refresh still affect end-to-end latency; it is not an instant or guaranteed sub-minute feed.
- Followed, pinned and previously shortlisted charts receive verification priority ahead of background discoveries. Routine LP checks target the tracked pool; explicitly requested secondary-pool checks still verify that exact pool. Calls sharing a provider take turns through its short spacing interval; long cooldowns and request limits still defer work. This prevents synchronized jobs from repeatedly displacing each other. Recent qualified bases retain candle-refresh priority for up to a day when their assessment becomes stale; freshness and price-in-range are still required for admission, and every third candle turn remains available for general coverage.
- **View checks → Recheck** requests fresh controls, metrics, LP protection and sample quotes. Requests are deduplicated for one minute and audited; failed or missing evidence does not become a pass. Verified starting-supply proof is reused, and incomplete supply history resumes its saved cursor. Completed checks do not require manual inclusion. Saved trading reviews remain in a collapsed disclosure; accepted trading warnings do not repeat above the chart. Unresolved mandatory checks remain visible. The panel shows individual result ages and supply-search progress, including a completed search with unavailable proof. It does not imply that a requested check has already run.
- Trading progress comes from the collector's actual scheduling gates: deferred until a setup/follow/request, waiting for prerequisites, queued, checking, retrying, provider-delayed or current. Background price updates do not imply a quote refresh. The header says **App synced**, row timestamps say **Market data**, and Screening details shows the last complete quote pair and attempt separately. Failed explicit quote requests remain scheduled across restarts with a two-minute retry interval until a completed result; provider cooldowns and budgets still apply. Completion ends a one-off request instead of permanently quoting every background coin.
- A persisted backward candle cursor requests earlier real history within the existing free request budget. Empty/failed history responses remain coverage limitations, never fabricated candles. Free indexing remains partial.
- First qualification saves an as-of snapshot. Later available metric observations at or after 6h, 24h, 72h and 1w are logged with actual delays and price changes, including negative values. Unavailable observations stay missing; this is not a backtest or execution return.

The thresholds are an initial implementation to calibrate with human review. Swarm is a shape example, not a hardcoded template or a confirmed successful outcome. Newscum illustrates why raw observations must stay out of the main shortlist. MG is a useful shorter-duration comparison. OP's hourly chart from September 22 through roughly midday September 24 illustrates a selloff followed by a gradually rising base. MARTIANS and OP are the user's preferred formation examples, judged before their later moves. A saved MARTIANS regression ends at 7:30pm London on September 27 and qualifies a two-hour range using only pre-cutoff candles. This is a structural replay of subsequently retrieved data, not proof of timely provider availability, historical eligibility or an actual live alert. Its cutoff is a reproducible detected window, not a resolution of the user's ambiguous verbal clock reference. No new human labels were manufactured for these examples, and OP has not been replay-tested against the detector from complete source candles.

### Proposed extensions, not implemented

Similarity search to find formations missed by fixed rules is not implemented. A full profile should retain normalized price path, own-coin relative volume, rise/retracement, range width, actual phase duration, activity, missing-data coverage and as-of time. The current JSON base assessment is a starting point, not a similarity model. Shape and outcome labels must stay separate. The implemented tier cutoffs still need reviewed calibration examples; there is no automatic retraining or validated prediction score in this version.

## Token controls and trading checks

The user requires irrevocably revoked mint/freeze controls, while explicitly allowing mutable names, symbols, metadata **and transfer-fee configurations**. The policy verifies a canonical Solana token program and its loader state. Standard Token-2022 shared-program upgradeability is disclosed as a notice, not an exclusion. Transfer-fee schedules, fee-setting authority and fee-collection authority are retained and shown. Fees still affect the live buy/sell quote economics. Unknown layouts/authorities stay pending; active mint/freeze powers, transfer hooks, permanent delegates, pausing/default freezing and other unapproved extensions remain excluded.

The initial stricter shared-program filter excluded MG and other Token-2022 tokens. The user explicitly corrected the policy: allow standard Token-2022 and transfer-fee configurations. The policy version changed, all controls are rechecked, and historical exclusion events remain in the audit instead of being rewritten.

After a detected mint passes controls, Jupiter Swap V2 provides quote-only requests without a taker or wallet: buy with **25 USDC**, then quote selling exactly the returned raw token amount to USDC. There is no signature, transaction submission or buy/sell simulation. Default screening hypotheses are at least $10,000 reported liquidity in the tracked pool, no more than 5% absolute quoted price impact per leg, and no more than 10% round-trip loss before network fees. The quote route can use other pools for the same mint. These defaults are not a proof of safety or a recommendation on trade size.

Control evidence expires after 24 hours, quotes after five minutes, and liquidity retrieval after two minutes. The server dynamically withholds stale checks; pinning, chart labels and restore cannot bypass the policy. An explicit manual trading-risk review can keep a named coin on the watchlist with its trading evidence available under Screening details; it cannot bypass current token controls, initial/current supply policy, the $1,000 hard liquidity floor, or verified LP protection. Metadata mutation and transfer-fee configurations are allowed. Shared standard-program upgradeability is a notice. Existing evidence is never removed merely because a coin becomes ineligible. The $30k floor is still **not** an exclusion; the separate liquidity rule can withhold a low-liquidity coin regardless of its market cap.

**Not verified:** holder/related-wallet concentration, unsupported liquidity-lock mechanisms and concentrated-liquidity positions, wash trading, wallet-specific frozen accounts, or execution under changing network/liquidity conditions. The UI says controls and quotes were checked, never that a token is safe, rug-proof or guaranteed sellable.

**LP protected** means this pool's recorded LP rights are verified as burned/non-redeemable or held by the recognized permanent lock authority. PumpSwap uses Token-2022 LP mints; Raydium CPMM uses legacy SPL Token LP mints. The checker verifies those separately from the coin's own token program. Genuine graduations with verified LP protection pass this check automatically; an exchange/launchpad label by itself never substitutes for evidence. Mint/freeze, supply, liquidity value and trading checks keep their independent results.

**Launch origin and initial issuance:** the scanner first batches canonical Pump.fun and Raydium LaunchLab accounts. Program ownership, derived addresses, mint identity and the recorded initial supply establish proof without searching trading history. StonkFun is identified by its published platform configurations; its public API supplies quote-mint hints only. Pump graduation requires the canonical destination pool; LaunchLab migration status belongs to the token's launch, while the selected pool's LP protection is still checked separately. Completed proof is cached, burns are allowed, and supply must still have started at exactly one billion. Unsupported or missing records remain pending. History runs at most once per minute, only for followed/promising charts or an explicit proof request, preserving old cursors. Parsed v1 transactions are supported. [API allocation, observed bottlenecks and limitations](docs/api-allocation.md).

## Activity log and review feedback

**Activity log** records discovery, migrations/cursors, changed observations and unchanged checks, candle additions/corrections, detector matches/nonmatches with settings, control/quote checks, observed group changes, request starts/completions/failures, source gaps and manual actions. Each entry has an ID, UTC timestamp, category, mint/source and evidence. Filter by category and exact mint/source; export the filtered or complete history as NDJSON. Credentials, headers, program binaries and transaction payloads are omitted/redacted. This is a local append-only application history, **not tamper-proof storage**. It begins at the recorded enable event; older missing events are not invented.

Unchanged metric values reference the earlier saved snapshot; unchanged candle payloads are not duplicated. Corrections keep both versions in the audit. Candles, original detections, audit and feedback have no automatic deletion. Monitor disk growth in Sources & coverage and make backups; long-run storage costs remain unmeasured. This does not log every Solana transaction or archive every upstream raw response. It logs the scanner's inputs after normalization, observations and decisions. Byte-for-byte upstream response archiving and remote log shipping are not implemented.

On any pool, **Chart feedback** captures initial-formation fit, present base stage, scope fit, the main reason and notes. A review freezes the pool metrics, risk state, original/current episode, detector settings and up to 1,000 completed candles at each available 5m/1m interval, plus linked-pool comparisons, supply evidence and pool-specific LP protection. Unknown evidence is not labeled as a confirmed rug or liquidity pull. A later review is a new entry; the earlier judgment remains. Imported charts without detector signals can be labeled to investigate misses without fabricating a detection.

**Review feedback** summarizes the latest judgment per pool/episode and retains all review versions. The exported dataset includes frozen evidence. Counts describe the user's selected reviewed charts, not market-wide precision/recall. Actual missing patterns not imported/reviewed remain unobserved. Once sufficient diverse examples exist, propose a versioned rule/scope change, tune on earlier examples, then compare in shadow on later unseen charts before adopting it. Keep immutable-control and trading requirements fixed. This release collects and summarizes feedback; it does not retrain itself or change thresholds automatically.

## First-version boundaries

The [master plan](SCANNER_PLAN.md) still defines the intended full scope. This release is a live pilot, not completion of every coverage/latency gate in that plan.

| Area | Current limitation |
|---|---|
| Discovery completeness | Public indexed feeds can lag or omit pools. Roughly one-minute discovery/metrics is a target, not a measured guarantee. Required route gaps remain visible. |
| PumpSwap origin | Migration events are genuine upstream reports; the destination pool is selected from matching indexed pools. A canonical destination decoder and reconnect-history guarantee are not yet implemented. |
| Raydium | LaunchLab signer reconciliation is implemented, with configurable signer addresses. Automatic discovery of every configuration/signer and all third-party graduation routes remains open. A full bounded signature page marks a possible gap. |
| Meteora | DLMM discovery is context only; DAMM collection and Meteora chart screening are paused. Direct-seed versus DBC origin is not inferred from token names. DAMM v1 creation and DBC migration verification still require additional event adapters. |
| Broad volume | Indexed windows are used. Exact per-swap volume, unique traders, and manipulation analysis are not implemented. Funding is never synthesized into swap volume. |
| Candles | Public OHLCV coverage is incomplete and rate limited. Most recent pools cannot have a completed multi-candle formation yet. Failed chart checks retry and remain visible. Native Meteora candle fallback still needs validation. |
| Cheap screen | Quiet noncandidate pools receive a reserved rotating share of candle requests. Public discovery, backlog and incomplete history can still miss patterns; this is not a statistically representative recall estimate. |
| Volume baseline | A preceding equal-length baseline is used when available, otherwise at least three preceding contiguous bars from the same coin. Launch-peer comparison is not calibrated; missing-baseline structures stay provisional. |
| Retention | Candles and candidates are not expired. Disk growth and snapshot rollups need measurement before a long hosted run. No monthly storage promise is made from a short pilot. |
| AI | The export workflow works; an in-app model integration is not enabled. Human chart labels remain the decision. |
| Predictive quality | No profitable edge, breakout probability, or accumulation claim is established. The supplied screenshots are one example; chronological labeled evaluation is still required. |

Initial automatic candle checks wait for approximately 15 minutes of pool age; a requested chart check can run earlier. A fixed dollar-volume minimum is no longer required to receive rotating chart coverage. No market-cap ceiling or lower price floor is applied to the pump detector.

The starting detector checks 3, 6, 12, 24, 36, 48 and 72 five-minute candles, a 2× close rise, at least three active bars, and advancing closes on at least 60% of transitions. Supported volume is mean candle volume at least 3× the same coin's preceding median. A six-hour episode cooldown suppresses repeated flags from the same continuing move. The first flags may be provisional and later acquire volume evidence, with its later timestamp retained. Pullback settings of 20–75% are stage labels, not an eligibility deletion rule.

Recent pool metrics target 60-second refresh; all unarchived candidates target 60 seconds to keep liquidity evidence current. Candle requests use five-minute or 15-minute due times according to candidate review and pin status. Due work competes for a shared queue, so backlog and source cooldowns add delay. Slower refresh delays observing market-cap crossings; the UI shows retrieval times. Indexed providers do not supply a trustworthy trade-level as-of timestamp for every response.

## Storage, verification and backup

The database is `data/observatory.sqlite`, using SQLite WAL. Original research JSON files are read-only reference evidence, not seed inputs to the live app. Provider request limits and queues survive restarts where stored; active connection state restarts normally.

```sh
npm test
npm run build
npm run backup
```

The tests cover closed-candle/no-future-data detection, wicks, missing baselines, gaps, pullbacks/collapse, honest aggregation, provider normalization, below-$30k boundaries, stale/FDV values, pin/archive/restore, long retention, deduplication, persistence and backup restoration. They do not establish market-wide data completeness or predictive performance.

`npm run backup` creates a consistent snapshot in `backups/` while the app can remain running. Keep a copy off the machine yourself. To restore, stop the server; move the existing database **and its `-wal`/`-shm` files together** to a retained safety directory; place the selected backup at `data/observatory.sqlite`; then restart. Do not replace a database underneath a running collector. Automatic off-machine backup/hosting remains deployment work.

The next acceptance step is a sustained local pilot: measure each route's discovery/volume lag, missing candle coverage, source throttling, memory/disk growth and candidate review quality. Use the exact token/pool from the reference screenshot if available, plus unrelated positive and negative examples. Do not lower thresholds just to fill the panel.

## Source references

- [PumpPortal migration and trade subscriptions](https://pumpportal.fun/data-api/real-time/) — this app subscribes to migrations only.
- [DEX Screener pair API](https://docs.dexscreener.com/api/reference).
- [Meteora DAMM v2 API](https://docs.meteora.ag/developer-guides/damm-v2/api-reference/overview) and [DLMM API](https://docs.meteora.ag/developer-guides/dlmm/api-reference/overview).
- [GeckoTerminal API](https://apiguide.geckoterminal.com/) and [OHLCV field semantics](https://docs.coingecko.com/reference/pool-ohlcv-contract-address). This app calls the public GeckoTerminal endpoint, not CoinGecko's paid endpoint.
- [Raydium LaunchLab configuration](https://docs.raydium.io/products/launchlab/global-config).
- [TradingView Lightweight Charts](https://tradingview.github.io/lightweight-charts/docs) renders the charts locally. Its required attribution appears on the chart panel.

No private keys, transaction signing, order execution, purchased data, cloud deployment or external messaging is implemented.

Additional primary references: [Solana authority revocation](https://solana.com/docs/tokens/basics/set-authority), [token extensions](https://solana.com/docs/tokens/extensions), [program upgrade authority](https://solana.com/docs/core/programs), [Jupiter quote-only orders](https://developers.jup.ag/docs/swap/order-and-execute), and [Swap V2 field definitions](https://developers.jup.ag/docs/openapi-spec/swap/v2/swap.yaml). The current API uses `priceImpact` in percentage points; deprecated `priceImpactPct` is a fraction and is not silently substituted.

## Manual trading-risk inclusion

The user specifically confirmed a manual review of MG (`9UtaRjir5Q4HRG8d8Z8F7jRgHGLBBwp7PR4rgBnoyr3z`). The app can retain a named candidate in Watching after an explicit recorded manual review, even when the sample-quote or optional $10k liquidity screen withholds it, provided every mandatory check passes. The automatic result remains unchanged and visible. This is the user's inclusion decision, not an automated safety certification, and it does not label the chart pattern as a match. It is auditable and reversible through the chart panel. Active mint/freeze controls, unapproved extensions, or stale/unverified mandatory controls, supply or LP protection still block active eligibility. The new mandatory liquidity floor is $1,000 USD-equivalent and cannot be overridden. New quote warnings continue to be recorded; the manual review keeps its original timestamp.

## Current scope and evidence gates

See [CURRENT_SCOPE.md](CURRENT_SCOPE.md) for the September 27 amendments, limitations, learning-data semantics and primary source references. These amendments supersede earlier three-venue planning assumptions. The initial-pump detector, original evidence, long base tracking, manual reviews and cost budget are preserved.
