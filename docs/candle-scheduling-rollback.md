# Candle scheduling trial — operation and rollback

Implemented 28 September 2026. The live setting is persisted in SQLite as `candleSchedulerMode`. The default is `legacy`; the authorised trial is explicitly enabled after validation. No paid feeds or additional credentials are introduced.

## View results

Open **Research & settings → Sources & coverage** (also available in Settings). **Candle request results** shows the recent trial's different tokens checked, first chart checks, request purpose, due work, rate limits and the last requests. The pre-trial reference is the preceding hour of candle HTTP responses, not a forecast or a controlled comparison. Requests already in flight may finish when switching modes.

Snapshot observations accumulate prospectively in five-minute buckets, including unchanged successful polls. They are retained for seven days per pool; original snapshots/audit history are unaffected. The priority hints start working after sufficient observed coverage exists, generally at least 45 minutes for the shortest window. Existing candle-based promising charts, first looks and quiet revisits work during this warm-up. Snapshot scores change scheduling only; the existing detector and eligibility checks still decide shortlist admission.

The earlier priority balance uses a 50/20/20/10 rotation. Both balances borrow unused shares. Quiet revisits are ordered by waiting time rather than snapshot score. A first look does not require witnessing the launch live. Primary-pool selection coalesces automatic work; explicit secondary-pool inspection remains possible. The existing candle history is reused and regular responses request a bounded overlap.

GeckoTerminal starts with a local ceiling of eight requests/minute, including discovery; actual throughput may be lower. HTTP 429 reduces pacing and preserves Retry-After. Successful requests gradually recover the ceiling. Limits, spacing, work and retry state survive a restart.

## Discovery and Early signs balance

The `discovery` profile (`discovery-early-priority-v2`) reserves candle turns as follows when every queue has due work:

| Purpose | Target share |
| --- | ---: |
| First chart assessments | 35% |
| Early signs refreshes | 25% |
| Promising bases and snapshot hints | 20% |
| Quiet chart revisits | 15% |
| History and requested chart views | 5% |

First checks are ordered by waiting time. Early signs refreshes are queued ten minutes after their last attempt and ordered by evidence freshness deadline. Existing candle-supported bases retain a five-minute target; snapshot-only hints use twenty minutes (fifteen for followed or pinned charts). These are queue targets, not guaranteed completion times. Provider limits, backoff, cached candles and pool coalescing still apply.

An otherwise eligible Early signs observation whose candles expired within the last day can earn another assessment. This does **not** extend the thirty-minute UI freshness requirement, manufacture timestamps or admit stale charts. Older observations retain their quiet revisit route. Known exclusions, extreme-retracement holds, inactive charts and archived tokens do not gain Early signs priority. Detector, safety and tier-admission thresholds are unchanged.

**Sources & coverage → Candle request results** shows the balance, requests per purpose, first-check waiting time, expired Early signs assessments and successful refreshes. Results start at the balance change; the preceding window is saved separately. First assessments do not necessarily produce shortlist matches.

To undo only this change, click **Restore earlier candle balance** in that panel, or run:

```sh
npm run candles:balance
```

To select it again:

```sh
npm run candles:discovery
```

The profile is persisted as `candlePriorityProfile`; existing installations default to `balanced` until explicitly changed. `PUT /api/candle-scheduler` accepts `{"profile":"discovery"}` or `{"profile":"balanced"}`. Selecting a profile while the original scheduler is active does not enable priority mode; use `candles:prioritise` for that. Switching restores the prior balance and cadence without a restart or loss of evidence, feedback or retry state. A request in flight may finish under its original profile.

Pre-change source backup: `backups/before-discovery-priority-20260928.tar.gz`. A consistent database backup is taken before deploying. Prefer the runtime balance switch; do not replace the database to roll back scheduling.

## Restore the original scheduler

Click **Use original scheduler** in that panel. No restart or database restore is needed. This restores the scheduler from before the priority trial, metric intervals, separate history job and provider pacing; any current provider cooldown is still respected. Charts, observations, feedback, tags, alerts and trial evidence remain saved.

Equivalent command from the project root:

```sh
npm run candles:revert
```

To re-enable:

```sh
npm run candles:prioritise
```

These commands call the running local app. `GET /api/candle-scheduler` reports the active mode and results; `PUT /api/candle-scheduler` with JSON `{"mode":"legacy"}` or `{"mode":"priority"}` changes it. If the server cannot start, set the existing SQLite `meta` key `candleSchedulerMode` to the JSON string `"legacy"` while the server is stopped, then restart. Do not restore an older database for a routine scheduling rollback.

## Recovery backups

- Original source and built UI: `backups/before-candle-policy-20260928T020658Z.tar.gz`.
- Consistent pre-edit SQLite backup: `backups/observatory-2026-09-28T02-06-57-182Z.sqlite`.
- Another consistent backup is taken immediately before live restart; see the backup directory timestamps.

For source recovery, stop the server and inspect the archive before restoring affected files. Keep the current database: all new schema tables are additive and the old code ignores them. Do not overwrite subsequent unrelated edits or restore a stale database over newer feedback. Prefer the runtime switch above.

## Validation and interpretation

Tests cover weighted fairness, deferred versus dispatched requests, rate-limit backoff, persistence, primary-pool deduplication, cache reuse, archives, unchanged observations, quiet revisits, rising/dead/gappy snapshot histories and rollback. A copy of the actual records was used to check both UI controls and unchanged hashes of saved candidates, feedback, episodes, notes and candles across a mode switch.

The discovery-balance rollout passed all 122 tests and the production build. Its UI activation and rollback were checked on a paused copy of real records; hashes of candidates, episodes, candles, notes, feedback and tier reviews were unchanged. The live report is saved in `test-results/discovery-priority-live-report.json`, with the pre-change comparison saved separately. The rollout database backup is `backups/observatory-2026-09-28T12-18-42-408Z.sqlite`.

The trial does not establish a hit rate, return prediction or overall missed-formation rate. Quiet-check discoveries help audit the screen, but limited sampling and history coverage must remain visible. No independent candle provider is enabled in this first rollout.
