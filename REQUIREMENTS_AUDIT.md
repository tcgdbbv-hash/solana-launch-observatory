**Requirements audit — original scanner and later pattern/watchlist changes**

> Current September 27 user amendments: [CURRENT_SCOPE.md](CURRENT_SCOPE.md). Active chart scope is PumpSwap/Raydium; Meteora DLMM is a linked discovery/context signal. New mandatory supply and liquidity gates apply. This amendment takes precedence over older scope/eligibility descriptions below; original requirements remain as history.

27 September 2026. Compared the user's original request, subsequent clarifications in the conversation, the saved infrastructure research, the current implementation plan and the detector specification. This is a document audit; it does not establish that any scanner capability has been implemented or validated live.

**Finding**

The core product changes were preserved. However, consolidation into the master plan made some original infrastructure requirements too implicit: broad volume monitoring before pattern selection, recent-pool update speed, the full venue coverage obligation, fallback/recovery details and exact volume accounting. Those requirements have now been made explicit again in the [master plan](/Users/bv/Documents/SCAN_INFRA/SCANNER_PLAN.md), with matching clarifications in the [detector specification](/Users/bv/Documents/SCAN_INFRA/PATTERN_SCANNER_SPEC.md).

The saved [infrastructure research](/Users/bv/Documents/SCAN_INFRA/research/INFRA_RESEARCH.md) already contains some later amendments. It preserves earlier technical decisions and evidence, but is not an untouched transcript of the first draft. This audit therefore anchors requirements in the conversation and identifies implementation proposals separately. The research evidence files were left unchanged.

**Traceability to the conversation**

| Source requirement or clarification | Required outcome | Audit result / location in master plan |
|---|---|---|
| Original: cheapest practical Solana scanner; research possible approaches online | Start locally, use free allowances where validated, keep spending bounded and preserve source comparisons | Preserved: Data sources; Infrastructure and cost controls; research links |
| Budget answer: $0–$25/month, delays up to a minute acceptable | Treat roughly one-minute discovery and recent-pool metrics as the target; measure upstream lag and coverage | Strengthened: explicit discovery and 30–60-second metric rows; separate volume, candle and pattern latency |
| Original: volume of newly graduated PumpSwap pools | Discover the successful graduation and monitor its destination-pool volume | Preserved and expanded: explicit PumpSwap route and provenance rules |
| Original: volume of newly graduated Raydium pools | Retain the Raydium requirement beyond the first demonstrated LaunchLab source | Strengthened: CPMM/legacy AMM routes, other origin coverage, unsupported paths recorded |
| Original: volume of new launches seeded on Meteora | Include direct seeding, rather than restricting Meteora to curve graduations | Strengthened: DAMM v2/DLMM direct launches, DAMM v1 coverage work and separate DBC migrations |
| Later: automatically identify the initial pump in Image 2 with relatively large volume | Add actual candle analysis to broad volume screening; save the initial episode before a future base exists | Preserved: pipeline and detector; broad scanning now explicitly precedes candidate selection |
| Later: manually assess subsequent accumulation with AI assistance | Keep a review workflow with chart history, numerical evidence and human decisions | Preserved: panel and AI assistance; resemblance is evidence for review, not proof of accumulation |
| Range reply: preference, not a hard filter | Use $30k–$250k to prioritize review, not reject candidates | Preserved: agreed behavior and panel filters |
| Range clarification: market cap during later consolidation; initial peak can exceed $250k | Do not cap the initial pump or confuse token price with market cap | Preserved: detector, panel and explicit market-cap basis |
| Consolidation can develop for longer than roughly two days | Keep tracking through days, weeks or longer, without an age-based expiry | Preserved: Following candidates for weeks; full retained base history |
| Below $30k: previously detected large-volume/pump coins go to “Dropping below $30k” | Keep those candidates, their original evidence and review history; change UI grouping | Preserved: exact boundary behavior; no replacement lower cutoff or automatic removal |

**Original technical essentials restored to the controlling plan**

These are implementation safeguards from the earlier infrastructure design, not additional trading criteria:

1. **Broad pool registry and volume collection.** Pattern nonmatches remain inspectable. Discovery does not begin only after a coin qualifies, and inexpensive screening must not be described as complete pattern coverage. A simple scanned-pool view is proposed to expose this evidence.
2. **Coverage by route.** A successful LaunchLab test does not prove all Raydium coverage. Direct Meteora seeding remains distinct from DBC migration. Unknown origin stays unknown; new pools for old tokens are identified separately. Required but unsupported routes remain visible gaps.
3. **Fallbacks and recovery.** Preserve PumpPortal migration discovery, LaunchLab signer/configuration polling, Meteora paginated lists with overlap, creation-event coverage where lists are insufficient, and an optional RPC fallback to validate. Retain checkpoints, reconnect/backoff, quota-bounded backfill and visible unresolved gaps.
4. **Correct volume.** Separate indexed rolling windows from exact swap buckets; keep curve and destination-pool volume separate; exclude funding and liquidity operations; deduplicate individual swaps without discarding legitimate multi-swap transactions. Preserve units, conversion times and data freshness.
5. **Partial history.** Cold starts, outages and unavailable backfills show an observed-since timestamp and incomplete coverage. Missing data must not become zero volume or a fabricated flat base.
6. **Complete cost accounting.** Budget discovery, broad volume snapshots, candidate candles, metadata, recovery and optional selected swaps together. The illustrative candle queue is not a capacity forecast for the whole system. Preserve discovery before optional expensive trade tracking.
7. **Verification before deployment.** Test actual destination pools on each required route, compare selected volume against transaction evidence, measure missing/late results and run a local infrastructure pilot before choosing hosting. Existing probes remain samples, not proof of full coverage.

**Changes that intentionally supersede earlier proposals**

- The original first-hour emphasis is insufficient for the multi-hour initial pattern. Continue screening beyond that; any intensive-screening horizon remains subject to measured misses.
- A blanket short retention period for chart aggregates cannot truncate an unfinished base. Preserve the initial pump detail and continuing history for unarchived candidates, including beyond 30 days. Short raw-swap retention is a separate storage choice and must not delete that evidence.
- $30k is a grouping threshold, not an exclusion floor. $250k is a preferred consolidation-band boundary, not an initial-pump ceiling.
- The approximately two-day chart illustration does not impose a two-day expiry.
- Broad volume snapshots remain useful, but real OHLCV is now needed to assess candle structure. The pattern layer adds data requirements to the initial infrastructure plan.

**Proposals that must not quietly become requirements**

The following settings originated as implementation or calibration suggestions, rather than instructions from the user:

- A roughly 2× pump, roughly 3× relative volume, peer-volume percentile, minimum active candle count, 15–180-minute rise, 20–75% pullback and six-hour pullback window.
- Five-minute computation with 15-minute review candles; a 24-hour intensive launch-screening horizon.
- Five-minute/15-minute/hourly-to-six-hour candidate refresh tiers and a sample capacity of 240 candle-tracked pools. Slower refresh also delays observing market-cap crossings; disclose that tradeoff and measure the actual workload.
- A 48-hour infrastructure pilot, a one-to-two-week first pattern review and a 95%-within-60-seconds reference benchmark. These are evaluation proposals; they neither expire candidates nor establish acceptable loss of coverage.
- Exact provider selection, server size, panel labels other than the requested below-$30k section, pinning controls, and evidence export as the cheapest first AI workflow.

The permanent-candidate policy, manual archive/restore, recovery at or above $30k, exact boundary semantics and treatment of stale values are retained design rules that support the user's requested ongoing review. They should not be confused with verbatim user wording.

**Remaining feasibility questions**

Authenticated filtered discovery, required instruction coverage, candles on actual target pools, usable market-cap supply data, sustained source latency and the combined request/credit budget still need a live pilot. No update to this plan resolves those by assumption. If the measured budget cannot support a required route or the desired speed, report the specific gap and cost tradeoff rather than silently narrowing scope.

Future revisions should update this traceability record whenever a requirement changes. A proposed optimization may change polling priority or storage format, but must not silently remove a venue, broad volume scanning, a retained candidate, its initial evidence, or the requested below-$30k grouping.


## Later user additions — controls, logging and learning (2026-09-27)

These additions preserve initial pump-plus-volume detection, all three target venues, soft consolidation cap preference, no age expiry, and below-$30k evidence retention. A failed mandatory control/trading check now overrides **active eligibility**, not the retention of original chart evidence.

- Mandatory on-chain issuer mint/freeze revocation and no unapproved control extensions. User clarification explicitly allows standard Token-2022 shared-program upgradeability as a notice, plus transfer-fee configurations and metadata changes. Fee schedules and retained fee authorities are disclosed. Missing verification stays pending.
- Separate read-only buy/sell quote and liquidity/impact screen. Passing is not a trading-safety guarantee; concentration, lock/withdrawal rights and wallet-specific execution remain unchecked.
- Persistent event history with timestamps, evidence, exclusions, gaps and manual actions; UI filters and history export. No synthetic history before logging was enabled, no secret/API-key capture, no automatic history deletion.
- Structured per-chart feedback and immutable-as-recorded review snapshots, including charts the detector missed. New reviews retain old labels; summary counts deduplicate the same pool/episode. Feedback dataset is exportable for later chronological calibration and unseen-chart evaluation. No automatic threshold changes or safety-policy relaxation.

The current implementation and its tested boundaries are documented in README.md. Full ingestion coverage, validated predictive quality, autonomous model training and guaranteed tradability are not claimed.

- Further explicit user correction: MG was manually reviewed by the user and should remain tracked. An auditable per-mint manual trading-screen inclusion can override quote/liquidity warnings while preserving their displayed evidence. It never bypasses current mandatory mint/freeze/extension checks, and it does not supply a positive formation label. Approval remains dated and can be removed in the UI. Global defaults are not silently lowered for other coins.
