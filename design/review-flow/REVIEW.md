# Consolidation review workflow — 27 September 2026

## Implemented

The primary flow is Shortlist → review chart → Follow, Give feedback or Archive. Early discoveries remain in Background observations and no longer generate discovery popups. Notifications are for qualifying bases, changed bases and subsequent range transitions on followed or previously shortlisted charts. Legacy alerts and all observations remain stored.

The workspace uses neutral charcoal surfaces, rounded controls, a compact price/liquidity/market-cap header and one chart workspace. Detailed screening, source evidence, review history and cap history expand on demand. Feedback opens in a dialog; tags and notes are saved together. Not my setup archives without passing or overriding checks. Existing manual follows and archives are retained.

The versioned detector assesses sideways and gently rising bases. Rising channels measure swing width around their slope and still require activity, coverage, pullbacks, range tests and a preceding supported rise and selloff. Qualified rising bases receive additional review priority; measured tightening adds more. Tightness tiers describe width, separately from duration, cap location and screening status. They do not measure holder counts, holding periods or return probabilities.

## Verification

- Typecheck and production build passed.
- All 70 automated tests passed, including gradual low-dollar-volume rises, qualifying rising channels, compression, future-data exclusion, and rejection of one-way ramps, single steps, falling channels and inactive charts.
- Existing token-control, trading, supply, liquidity, pool identity, range, archive and audit tests remain passing.
- Browser verification used a consistent copy of real records with collection paused. Closing/reopening feedback retained a draft; saving Not my setup archived with its note; explicit restore preserved history. These review mutations were limited to the test database.
- Verified the one-minute and market-cap controls and feedback dialog in the browser. The native review controls work by keyboard.
- Restarted the main local service with the new backend, confirmed live collection and base-2 assessments, then refreshed the main browser tab. MG and SWARM remained followed with their original tags; WOFI remained archived as Not my setup. No labels were added for OP or MARTIANS.
- At the live check, there were no fully eligible shortlist entries or unread alerts. Four structural matches were retained behind pending checks; one also had stale candle evidence. No candidates were invented to fill the shortlist.
- The temporary QA service was stopped and the viewport override removed. The primary live service remains running.

## Evidence

- `01-before.png`: original information-heavy layout.
- `02-before-detail.png`: intermediate loading capture; not accepted as final evidence.
- `03-after-shortlist.png`: real live shortlist and quiet empty state.
- `04-after-review.png`: real live chart workspace.

## Limits and next calibration

The detector is an initial rule implementation, not a validated predictor. Full normalized-profile similarity search is not implemented. Tier and slope thresholds require chronological review across successes, failures and misses. OP's pre-breakout window is a visual reference, not yet an OHLCV replay validation. The six-hour proximity rule uses pool creation as a launch proxy and may miss later initial moves. Public indexing and historical backfill remain incomplete and rate limited; requested refresh intervals are not guaranteed. Historical market-cap charts use current implied supply.

Desktop browser layouts were inspected at the available viewport sizes. An attempted mobile viewport override did not reliably resize the target tab; mobile-device verification is not claimed. Longer unattended operation and predictive performance have not been established by these tests.
