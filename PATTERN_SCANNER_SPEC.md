**Initial pump detection with manual review of the later base**

> Current September 27 user amendments: [CURRENT_SCOPE.md](CURRENT_SCOPE.md). Active chart scope is PumpSwap/Raydium; Meteora DLMM is a linked discovery/context signal. New mandatory supply and liquidity gates apply. This amendment takes precedence over older scope/eligibility descriptions below; original requirements remain as history.

Specification updated 27 September 2026 from the two supplied screenshots. A first local implementation now collects live data and runs the initial-pump detector; see the [first-version guide](/Users/bv/Documents/SCAN_INFRA/README.md) for limitations. No remotely hosted scanner or predictive performance has been established. The specification continues to define the intended behavior beyond the pilot's current coverage.

The [implementation plan](/Users/bv/Documents/SCAN_INFRA/SCANNER_PLAN.md) controls product behavior, panel sections and build order. This document supplies detailed detector settings and review criteria. Any numerical detector thresholds below remain calibration proposals.

The user clarified that consolidation can develop well beyond the roughly two days illustrated. There is **no age-based expiry** for a flagged candidate; monitoring and review must accommodate days, weeks, or longer.

**The target**

Automatically identify the early pump structure in Image 2, place the token on a watchlist, and preserve its subsequent chart so the user can assess the developing consolidation with AI assistance. A future breakout is not part of the detection rule.

This pattern layer is added to the original broad scanner for new PumpSwap/Raydium graduations and seeded Meteora launches. Discover and monitor recent-pool volume before any pattern match; keep the registry and screening reasons inspectable. Route coverage, original volume accounting and fallback requirements remain in the controlling plan. Do not narrow the whole scanner to tokens already selected for candle analysis.

The user clarified that **$30k–$250k refers to market cap during the later consolidation**. Keep it as a preference, following the earlier clarification, rather than a hard exclusion. The initial pump may peak above $250k. Consolidation is also allowed below $30k: a token that previously qualified through its pump and volume goes into the UI section **“Dropping below $30k”** when its current market cap falls below that level. This changes its grouping, not its eligibility or retention.

References: [Image 1](/Users/bv/Downloads/Print.png), [Image 2](</Users/bv/Downloads/Print (1).png>). These are two annotations of the same chart, not two independent training examples.

**What the screenshots show**

- Both display 15-minute candles. Image 2 contains a multi-candle rise, prominent early volume, a peak, and a substantial retreat. Its rectangle includes the pullback, not just green candles.
- Image 1 extends across a much longer period: the large initial moves give way to generally smaller candles, lighter volume, repeated trading around a range, and intermittent attempts upward. The full rectangle spans roughly two days; exact prices and event times require source candles.
- Some of the illustrated range appears above $250k, so use the chart as a structural reference rather than an exact numeric template.
- The later rally at the right is outside the requested early signal. It must be hidden when labeling or evaluating earlier candidates.

OHLCV can establish consolidation and activity patterns. It cannot by itself establish that informed holders are accumulating. Review labels should say “possible base” or “consistent with the reference,” with supporting and conflicting evidence.

**Two stages, with an optional early heads-up**

| State | What we know at that time | Action |
|---|---|---|
| New pool / graduation | Pool exists and trading is available | Begin inexpensive monitoring |
| Pump developing | Price has advanced through several candles with meaningful activity | Save a provisional candidate; optional early heads-up |
| Initial pump plus pullback | An observed high is followed by a measurable retreat; the early episode resembles Image 2 | Main automatic watchlist event |
| Possible base developing | The subsequent range may resemble Image 1 | Present for manual review; AI explains evidence |
| Continue / prioritize / archive | User's assessment and new observations | Continue monitoring, increase review priority, or archive with a reason |

Use labels based only on information already available. Do not backdate a completed-pump alert to the high once later candles establish a pullback. A token with no clear retracement can remain in “pump developing”; a collapsing chart remains a recorded candidate with adverse evidence rather than disappearing from the evaluation set.

Save the original signal as a historical record: its qualification time, candle window, initial volume and price features, and detector version. Later price/volume changes must not undo it. Separate the original signal, current formation stage, panel grouping, review status and monitoring priority. Deduplicate the watchlist by mint and attach repeated pump episodes to that same candidate.

**First detector: simple, measurable features**

Start with five-minute candles for computation and a 15-minute review chart. Evaluate several durations to allow similar shapes at different speeds. Fractal here means a repeatable relative shape, not a requirement for identical candles or pixel matching.

The following are **initial calibration settings**, not thresholds inferred precisely from the screenshot or a proven strategy:

| Feature | Initial setting to test | Purpose |
|---|---|---|
| Launch observation period | First 24 hours after graduation / first trade as a trial intensive-screening horizon | Capture pumps that develop over hours; not an agreed eligibility cutoff; measure later misses before reducing monitoring |
| Rising-leg duration | 15, 30, 60, 120 and 180 minutes | Find both quicker and slower versions |
| Price expansion | About 2× or greater on closing prices across a tested window | Broad candidate screen; do not use one wick as the whole pump |
| Structure | At least three active candles, advancing closes/highs, and meaningful bodies | Distinguish a traded move from an isolated print |
| Relative volume | Around 3× a comparable prior median when adequate history exists | Identify an expansion in participation |
| Little or no prior history | Rank volume among launches of similar age, venue and liquidity; initially inspect the upper quintile | Avoid dividing by zero or treating every first trade as a volume spike |
| Pullback | Initially examine retreats of roughly 20–75% from the running close-based high | Broad similarity preference for the Image 2 episode; keep tails for review |
| Pullback timing | Look over the following 15 minutes to six hours | Allow the slow fade illustrated in the reference |
| Volume after the peak | Compare equal-duration volume rates before and after the high | Falling activity is supporting evidence, not sufficient confirmation |

Implement price expansion as the latest completed close divided by the first completed close of each evaluated rising-leg window. Require adequate trading coverage in that window. Store maximum high and maximum close separately so a single extreme wick cannot manufacture a close-based impulse. Use a running observed high for pullback features and record when the retreat first became detectable.

Treat movement size, volume expansion, candle continuity, pullback shape, and data quality as separate reasons for a match. Initially prefer an explainable feature list over an opaque “AI confidence” score. Liquidity and trade counts should flag thin or concentrated activity; set their minimum values from the pilot rather than inventing a universal dollar threshold.

For launches without a baseline, a small or incomplete peer group must be marked insufficient. Retain promising price structures for review instead of labeling weak volume evidence as confirmed. Compare equal windows and use only data available at the candidate timestamp.

No later accumulation or breakout is required for the first-stage detector to fire. Candidates that fail later are important examples for measuring noise.

**Follow-up review: the base is a human decision**

Keep qualifying tokens on the watchlist **until the user archives them**, whether a base takes hours, days, weeks, or longer. Age alone does not invalidate the formation. Pinning raises monitoring priority; it is not required to prevent expiry. Suggested initial review points are after the pullback and around 6, 12, 24, 48 and 72 hours, followed by daily or meaningful-change reviews for as long as needed. These are proposed product checkpoints, not scheduled automations created by this document.

At review time display:

- Range width and whether the range is tightening compared with the impulse.
- Whether lows stop declining, a floor is retested, and rebounds are repeatedly rejected at similar levels.
- Pullback depth, time spent ranging, and continuing presence of real trading activity.
- Volume contraction during the range and any fresh expansion; distinguish quiet trading from missing data.
- Current and median range market cap, plus time spent in the preferred $30k–$250k area.
- Liquidity changes, isolated wicks, repeated heavy selling, and other observations that weaken the resemblance.

Repeated lower lows, persistent large-range candles, disappearing liquidity, or a flat line with no trading should be visible as conflicting evidence. A temporary range can also be distribution; the chart alone does not settle that question.

The user decides whether to continue, prioritize, or archive. Flag apparent failure, inactivity or loss of liquidity without deleting the recorded candidate. Missing source data is a separate state. AI is an assistant for that review, not the decision-maker for trade execution. The scanner does not place orders.

**The review screen and AI input**

Each candidate should have a mint and pool link, venue and origin, age, alert timestamp, and a concise explanation of the initial match. Show synchronized five-minute and 15-minute candles with volume beneath, plus a marker at the exact alert time. Include the initial move and the full subsequent history; allow linear/log price views and hourly/four-hour views for bases developing over weeks. Preserve the initial pump detail even as the broader chart grows.

The panel must include a dedicated **“Dropping below $30k”** section:

- Entry requires an existing qualifying pump/volume record and a fresh, valid market-cap observation below $30,000. Do not populate it with unrelated low-cap tokens.
- Continue tracking and preserve the original pump, volume evidence, detector timestamp, complete retained chart history, and human/AI review notes. There is no new lower market-cap cutoff or automatic archive rule.
- Show current market cap, source/as-of time, first observed time below $30k, initial pump peak and volume, and latest review status. If the candidate is already below $30k at its first qualifying observation, label that fact rather than inventing a prior crossing time.
- Treat this grouping independently from the formation stage: a below-$30k candidate can still be pulling back, forming a possible base, or showing conflicting evidence.
- On a fresh, valid recovery to $30k or above, return the candidate to the appropriate main watchlist grouping and retain its below-$30k history. Exactly $30k is outside the below-threshold section.
- Missing, stale, or invalid market-cap data must not be interpreted as zero or trigger a crossing. Retain the last valid grouping with an explicit data-status marker. A fully diluted estimate must not silently substitute for verified market cap in this classification.

The other principal sections are **New pumps**, **Watching for a base**, and **Archived**. Below-$30k takes precedence for unarchived qualifying candidates, while an unreviewed badge preserves their review priority. Pinned is a filter/priority, not a mutually exclusive section. On recovery, use the stored review status to choose New pumps or Watching for a base. If no usable market-cap value exists, keep the candidate in its ordinary review section with market cap unknown. Repeated observations within the same group do not create repeated crossing events.

Separate shape assessment from scale: use relative/log price changes internally, then show price and market-cap context in the interface. Mark the preferred market-cap band. Use verified circulating supply for actual market cap where available; otherwise label price × total supply as an estimated fully diluted value. Unknown circulating supply must not become a confidently labeled market-cap number. Keep supply and price-source timestamps.

Never merge pools by simply joining their candles. A pool transition changes the venue and may create a price discontinuity. Use mint identity to link the histories, choose an explicit price source, and preserve migration boundaries. Keep curve and post-graduation volume separate. The current discovery scope is post-graduation/new-pool trading; if the desired pump occurred on the bonding curve, its earlier history needs a separate source and label.

For a requested AI review, provide numerical OHLCV and the rendered chart, as-of time, coverage gaps, unit definitions, and the detector's reasons. Ask for: supporting evidence, conflicting evidence, an approximate range, changes since the last review, and observations to revisit next. Allow “insufficient data.” Do not return an uncalibrated probability of a future breakout.

For MVP, use AI on user request through an exported evidence bundle and the existing assistant workflow. Automated reviews on selected meaningful state changes are a later option with an explicit cost cap. Calling a vision model for every candle is unnecessary for this workflow. Keep the first stage deterministic and reproducible.

**Candle data changes the infrastructure requirements**

The earlier plan's rolling-volume snapshots are useful for screening, but they cannot reconstruct open/high/low/close values or reliably identify this formation. We now need actual candle history for candidate detection and multi-day review.

| Source | Proposed use | Limits and verification |
|---|---|---|
| DEX Screener pair snapshots | Cheap initial price, volume and liquidity screen | Its documented public reference does not supply the candle history this detector needs |
| GeckoTerminal public OHLCV | Five-minute candles for known shortlisted pools | Free API; documented 30 calls/minute, shared with other requests; source delay and target-pool coverage remain to be measured |
| Meteora native OHLCV | Venue-specific candle source | DAMM v2 and DLMM document five-minute candles; validate denomination and trade coverage before use |
| Selected transaction stream | Precise candles for a restricted set where APIs lag or omit history | Consumes credits; not affordable as an assumed unlimited market-wide feed |

Sources: [DEX Screener reference](https://docs.dexscreener.com/api/reference), [GeckoTerminal public API](https://apiguide.geckoterminal.com/), [OHLCV and limits](https://apiguide.geckoterminal.com/faq), [Meteora DAMM v2 candles](https://docs.meteora.ag/api-reference/damm-v2/pools/ohlcv), [Meteora DLMM candles](https://docs.meteora.ag/api-reference/dlmm/pools/ohlcv).

The 27 September read-only candle probe returned HTTP 200 and four five-minute candles from GeckoTerminal for one known sample pool. That pool was a Pump bonding curve, so it verifies the request format, not PumpSwap/Raydium coverage. The Meteora candle request returned HTTP 400 with body `error code: 1010`; the cause was not established. Native candle access is therefore documented but not live-validated here. [Probe evidence](/Users/bv/Documents/SCAN_INFRA/research/ohlcv-probes.json)

For each adapter, verify target-token orientation, USD/native denomination, volume units, timestamp units, interval boundaries, no-trade intervals, revisions, and missing records. Assemble 15-minute candles from three UTC-aligned five-minute candles: first open, maximum high, minimum low, last close, summed volume. Do not treat absent data as zero-volume flat candles unless the provider confirms there were no trades. Do not finalize a bucket until its source data is complete enough under the defined lag allowance.

Pool discovery and broad recent-pool metrics still target approximately one minute, using proposed 30–60-second metric refreshes. A confirmed five-minute candle signal necessarily waits for the bar to close, plus provider delay. Measure first usable volume, discovery and candle arrival separately. An early price-snapshot heads-up can be provisional; it cannot promise the full completed formation within one minute. Slower older-candidate refresh tiers are proposed budget tradeoffs, not a replacement for the original recent-pool target; they delay observing threshold crossings and must be visible.

**Keep the $0–$25 budget through selective monitoring**

Broad discovery remains inexpensive; candle retrieval is now a potential bottleneck. Screen pools with price/volume snapshots, promote promising candidates to candle monitoring, and retain all discovered identifiers so screening exclusions can be audited. This economical design can miss patterns that never meet the cheap screen; measure that on a sampled unscreened control group.

An illustrative GeckoTerminal budget is:

| Queue | Pools | Refresh | Requests/minute |
|---|---:|---:|---:|
| Initial formations under inspection | 60 | Every 5 minutes | 12 |
| Developing bases | 60 | Every 15 minutes | 4 |
| Older retained candidates | 120 | Every 60 minutes | 2 |
| Bootstrap, overlap and retries | Budget allowance | Staggered | 2 |
| Total | 240 | | **20** |

These are candle-request capacity assumptions, not measured launch counts or a service guarantee. Budget broad discovery and 30–60-second recent-pool volume snapshots separately, then validate the combined workload. The 15-minute refresh tier still retrieves intervening five-minute candles. Long histories can require extra pages, so backfill through the same queue and cache permanently enough for the review period. Requests to other GeckoTerminal endpoints share its allowance. Use native Meteora capacity when verified, and retain headroom for HTTP 429 recovery.

Candidates above this capacity receive a visible delayed status or require a changed source/budget. Do not silently discard them. Long-lived, quiet candidates can move to a background queue checked every one to six hours; prioritized or changing charts get more frequent updates. New activity found in a background check promotes a candidate again, so a six-hour tier explicitly allows up to that checking delay plus source lag. Display the cadence and last successful update. Keeping an unlimited number of charts continuously fresh is not promised under $25.

Retain 15-minute history for the entire unarchived lifetime, preserve the original pump's five-minute candles, and retain recent detailed candles for continued review. A 30-day raw-data retention setting must not erase the beginning of a still-developing base. Track storage use and export older history rather than silently losing it.

Avoid forecasting trading returns from this workload calculation. The earlier $7–$15 hosted estimate remains a target subject to measured candle availability, request limits and storage. Automated model usage is additional and must be capped separately; manual assistance can use the user's existing workflow.

**How we validate the detector**

1. Assemble several distinct reference charts with pool/mint identifiers and candle data. One successful example is enough to describe a hypothesis, not to calibrate a reliable detector.
2. Include similar initial pumps that later fade, never form a base, or have misleading single prints. Label early structure separately from later base quality.
3. Replay candles chronologically. Freeze the features and chart at each alert timestamp; do not show later breakouts during early-stage labeling. Use chronological evaluation and keep the same token out of both calibration and evaluation groups.
4. Measure agreement with the user's initial-pump labels, time to alert, alerts/day, review burden, missed reference examples, stale/missing data, and monthly projected cost. Separately measure how many initial candidates later receive a user-approved base label. That is not a profitability statistic.
5. After collecting labels, adjust thresholds and durations together. A normalized shape-similarity model can be added later if it improves held-out results; begin with the auditable rules above.

The build order is discovery → candle adapters → early pump/pullback detector → persistent watchlist → manual review with AI assistance. A 48-hour infrastructure check remains useful, but validating longer bases requires continued cohort observation. Review pilot results after one to two weeks, without assuming candidates will have completed their bases by then; continue until there are enough labeled examples, including bases that take several weeks.
