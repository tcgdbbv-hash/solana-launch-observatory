# Shortlist stages

Added 28 September 2026. These are exclusive, live views of already collected evidence, implemented in `shared/shortlist.ts`. Automatic stages describe scanner evidence. Manual placement, added later on 28 September, is stored separately and never marks a base or safety check as passed.

1. **Early signs:** a supported rise and pullback on the candidate's own pool, recent candle evidence and market data, and observed activity. A base is not confirmed.
2. **Base forming:** a current supported range whose remaining formation issue is insufficient distinct range tests (at least two floor tests and one ceiling test), or a currently qualified base awaiting screening checks. Current price must remain in the observed or projected band. The card distinguishes these cases.
3. **Ready to review:** automatic entries use `shortlisted()`, now including the extreme-retracement hold. Manual entries are explicitly marked as the user’s placement and can have incomplete formation or checks.

Earlier stages reject archived/Not my setup records, excluded checks, out-of-scope venues, unverified or sub-$1,000 liquidity, stale evidence and inactive charts. An already qualified base whose current price left the range is not moved into an earlier stage. Insufficient or expired evidence stays available under Background observations or Following. The $30k–$250k market-cap preference remains a filter, not a hard stage boundary.

The final stage opens by default. Returning from a chart keeps the previously selected stage; using the Shortlist navigation starts at Ready to review. Stage totals cover the whole stage, while the result count reflects search, market-cap, venue, tag and pin filters. The sidebar count continues to mean Ready to review. Earlier stages produce no new alerts and are distinct from human tags and the five-point range-tightness measurement.

## Verification

- Regression tests preserve exact final-stage membership, transitions with pending checks, exclusions, same-pool evidence, stale data and broken ranges.
- Existing base and notification tests remain unchanged.
- Live API comparison confirmed final-stage membership matched the old shortlist.
- Browser verification covers stage switching, chart inspection and return navigation.

## Revert the UI addition

The pre-change UI and build are saved in `backups/before-shortlist-tiers-20260928T023757Z.tar.gz`. Restoring only `web/main.ts`, `web/style.css` and `dist` from that archive removes the stage UI. No database restore or server restart is required; reload the browser after restoring. This is separate from the candle-scheduling rollback.

## Manual tier placement

Use **Move tier** on a list card or the chart panel. Choose Tier 1, 2 or 3 and optionally write a reason. Moves work in both directions. The choice survives refreshes and server restarts until another move or **Automatic** is chosen. Following and tags stay separate. Archive, out-of-scope venues, liquidity below $1,000 and failed screening still keep a coin out of active tiers; a saved placement is retained for reference.

Each move is an append-only `stage_reviews` record containing the old displayed tier, destination, previous override, scanner tier, timestamp and reason. An evidence snapshot captures the pool, current base, drawdown, checks, settings, original episodes, linked pool context and completed candles available at that time. Later price moves or candle corrections do not rewrite this record. Request IDs prevent retries from duplicating feedback.

Tier history appears in the chart’s **Your review history** and the **Review history** page. **Export tier moves** downloads NDJSON with the frozen evidence. Chart evidence exports include the same records. A move is a human preference, not a ground-truth label or an automatically trained rule. Empty notes are allowed. Manual promotion does not trigger automatic qualification alerts; manual demotion suppresses automatic qualification while that placement remains below the final tier.

## Extreme retracement

`shared/drawdown.ts` defines the initial scope policy: a recorded decline of at least 95% from the same pool’s observed peak close holds automatic tiers. The hold remains until current price is more than 10% of that peak (less than 90% down), avoiding repeated entry/exit on tiny rebounds around 95%. Manual placement remains available, with the hold and actual checks disclosed. A new, smaller pump does not reset the earlier peak.

The peak comes from stored five-minute closes or earlier same-pool detector peak closes. Subsequent lows use closed prices and saved price snapshots, not single candle wicks. Future/unclosed data and secondary-pool prices are excluded. This is observed-history coverage, not a claim of a complete all-time high or proof a token is dead. Missing history stays unknown. Recovered coins still need all normal formation and eligibility checks.

Held charts leave the automatic promising-candle lane but keep background reassessment; explicit refresh and existing Following are preserved. Hold entry/recovery is audited, alongside the threshold version. These are provisional scope thresholds inspired by the user’s NEARPAD example, not validated predictive cutoffs. NEARPAD’s locally recorded peak close was approximately $0.00152161; the checked observations were around 95% below that peak. The user’s reported $30k low was not independently established by the stored history checked during this change.

## Manual-tier change backup

Code/build before manual placement and the drawdown hold: `backups/before-manual-tiers-20260928T030737Z.tar.gz`. Pre-deployment database backup: `backups/observatory-2026-09-28T03-13-55-087Z.sqlite`. For a feature rollback, restore the old server/shared/web/build files and restart; keep the live database so new tier reviews remain saved. Do not restore the older database unless intentionally recovering data. Browser mutation tests use `test-results/manual-tier-ui/observatory.sqlite`, never the live feedback store.
