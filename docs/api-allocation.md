# API allocation and bottleneck audit

27 September 2026. Budget remains $0–$25/month; no paid plan has been enabled.

## What was failing

The live audit around 20:55 London time found these counts over the preceding hour. They describe that observation window, not a steady-state rate or a measured improvement after deployment.

| Source | Observed bottleneck | Change / responsibility |
|---|---|---|
| Solana RPC | About 472 of 998 requests searched mint signatures; only two new starting-supply proofs were saved | Read canonical launch accounts in batches first. Cache verified origin, graduation and initial supply. History becomes a slow fallback for followed / promising charts or an explicit proof request. |
| GeckoTerminal | 43 HTTP 429 responses from 259 requests | Candles and indexed discovery. Recently qualified charts retain refresh priority when stale; shared cooldown and request budget apply. Broader adaptive candle scheduling remains future work. |
| Jupiter | 15 HTTP 429 responses from 554 requests; no API key configured | Quote followed / promising charts and explicit rechecks. Keyless spacing is now 2.2 seconds; with a configured key, 1.1 seconds. Local cap remains 20 requests/minute. Respect Retry-After and exhaustion/reset headers. |
| DEX Screener | No HTTP 429 recorded in the audited window | Existing batches of up to 30 pools provide price, cap, reported liquidity and activity; resolve linked pools using exact mint identity. These are indexed values, not proof of launch or locked LP. |
| PumpPortal | Reconnect gaps are possible | Migration notifications provide discovery hints. Canonical accounts establish origin; a feed label alone is not proof. |
| StonkFun | Newly integrated, not part of the historical audit | Public token lookup provides the original quote-mint hint when the selected secondary pool differs. At most one lookup per 30-second job, cached for a day. An API claim does not pass supply: LaunchLab state must confirm it. |

The audit also found RPC transaction-version errors and “minimum context slot not reached” responses. Those are distinct from external rate limiting. Parsed transaction v1 support has been added. Provider errors and local budget deferrals remain separate in connection status; the old logs do not support an exact count of local deferrals.

## Launch identity, cheaply

One finalized RPC batch checks up to 12 tokens (36 accounts). It reads the Pump.fun curve, its derived canonical PumpSwap destination, and the Raydium LaunchLab curve for each token and known quote mint. Mint controls are already batched separately.

- **Pump.fun:** verify the derived mint-specific curve address, owner and account discriminator; read the recorded launch supply. Graduation additionally requires curve completion and the canonical PumpSwap pool with matching creator authority and mints. Secondary pools cannot substitute for that destination. Mayhem origin can be identified, but its supply semantics are not assumed to match ordinary issuance.
- **StonkFun:** verify the derived LaunchLab curve, program owner, discriminator, base/quote mints and decimals. Match its platform configuration against StonkFun’s published standard/reward configurations. Read the curve’s own supply and migration-complete status. The selected trading pool’s LP protection remains a separate check; this record alone does not identify that pool as the migration destination.
- **Other LaunchLab platforms:** the same program-owned supply record can establish issuance without pretending the token is StonkFun. A shared Raydium venue does not identify the platform.
- Completed origin/graduation proof is reused. Unmatched lookups are cached for one day; verified but ungraduated records retry after five minutes. Old exhausted history cursors do not prevent the new account lookup. Existing creation-transaction proof is retained.
- A platform name, mint suffix or creator-wallet resemblance never receives a blanket one-billion supply approval. Actual recorded initial supply must match the existing one-billion rule; current supply may be lower after burns.

## Stock-paired coins

Keep three facts separate: selected-pool liquidity in USD from the indexer, selected-pool LP protection from on-chain rights, and the cost of a particular Jupiter buy/sell route. Jupiter may use several hops or different pools in each direction. Its quoted impact is not the selected pool’s liquidity, and USD-equivalent liquidity is not a USDC reserve balance.

A live read confirmed MG’s curve uses StonkFun’s reward platform, its quote mint is GLDX, its migration status is complete and the recorded initial supply is one billion. Saved Jupiter buy and sell routes both included its selected pool. This verifies route availability at those observation times; it does not independently validate the indexer’s USD valuation or guarantee execution. Fees/taxes remain part of the quote evidence and are not blindly subtracted from impact.

## What remains

- Broader adaptive candle scheduling: cheap snapshots decide which background charts deserve full candles, with periodic sampling to recover quiet setups. The current implementation improves priority but still rotates through background candle work.
- A free Jupiter API key would raise documented access from 0.5 to 1 request/second. No key or account has been created for the user.
- Unsupported launch layouts, historical direct CLMM StonkFun launches, missing original quote-mint hints and Mayhem supply may still require fallback evidence.
- Public RPC/indexer availability and accuracy remain external dependencies. No design can promise zero rate limits; batching, caching, bounded queues and backoff reduce demand without bypassing provider restrictions.
- LP protection is never inferred from a launchpad label. Later deposits, unknown lockers and secondary pools must be checked on their own evidence.

## Primary sources

- [Pump.fun program and curve semantics](https://github.com/pump-fun/pump-public-docs/blob/main/docs/PUMP_PROGRAM_README.md)
- [Pump.fun current IDL](https://github.com/pump-fun/pump-public-docs/blob/main/idl/pump.json)
- [PumpSwap canonical migration pools](https://github.com/pump-fun/pump-public-docs/blob/main/docs/PUMP_SWAP_README.md)
- [Raydium LaunchLab IDL](https://github.com/raydium-io/raydium-idl/blob/master/raydium_launchpad/raydium_launchpad.json)
- [Raydium LaunchLab address derivation](https://github.com/raydium-io/raydium-sdk-V2/blob/master/src/raydium/launchpad/pda.ts)
- [StonkFun developer documentation](https://www.stonkfun.xyz/developers)
- [StonkFun published platform configurations and launch parameters](https://www.stonkfun.xyz/api/public/v1/launchlab/pricing?quoteMint=So11111111111111111111111111111111111111112)
- [Jupiter platform access tiers](https://developers.jup.ag/changelog/developer-platform)
- [GeckoTerminal limits](https://apiguide.geckoterminal.com/faq)
- [DEX Screener API](https://docs.dexscreener.com/api/reference)
