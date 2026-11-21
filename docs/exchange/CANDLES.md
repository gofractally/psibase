# Native execution candles

Five supported intervals are 5, 15, 60, 3,600 and 86,400 Unix seconds. Buckets are
UTC-aligned. Each real nonzero aggregate execution updates exactly five current
rows, independent of historical size and participating wallet count. Native
trade, pooled stop execution and liquidation event sites each record their own
execution once. A zero input or output has no executed price and creates no bar.
OHLC describes these actual aggregate execution prints, as does the public tape;
it is not a reconstruction of the auction's internal marginal-price path.

`CurrentCandleTable` is appended at table index 15. Its key is `(market, interval)`;
it retains at most five current rows per market. OHLC stores exact quote/base
atom ratios, whose comparisons use u128 cross multiplication. Base and quote
volume use u128 limbs and counts use checked u64. Matching and accounting policy
are unchanged. Candle writes and emitted events roll back with a rejected native
transaction.

When the next real execution enters a later bucket, the previous nonempty row
is emitted to `candle5s`, `candle15s`, `candle1m`, `candle1h` or `candle1d` history,
then overwritten. Each event's first field is the market, with its native event
index registered at installation. Empty buckets are never generated. A quiet
market's last current row remains unsealed until another real execution; there
is no timer or background loop filling objective history.

Completed bars live in the native prunable event history, not historical
objective rows. Pruning can shorten available historical coverage. Their bucket
time is stored in the event and can precede the block in which a later execution
sealed it. Coverage begins at deployment of this recorder. Earlier native trade
events remain available according to retention, but no old bars are invented or
claimed as backfilled by this implementation.

The public reader is bounded at 200 bars per page. It seeks at most `limit+1`
market-indexed event IDs and fetches exactly those ROWIDs from native history.
It never scans all historical trades or all calendar buckets. Rows are newest
first. The first page may include the current bar; subsequent pages contain
completed bars only. `before` and `next_before` are opaque exclusive event-ID
cursors, not timestamps. A first page containing only the current bar uses an
exclusive cursor immediately above the newest closed event.

A page contains `interval`, `price_precision`, `candles` and `next_before`. Each
bar has Unix-second `time`, digit-string `open/high/low/close`, base-atom `volume`,
quote-atom `quote_volume`, digit-string `trades` and boolean `complete`. Closed
bars also carry their native `event_id`. Prices use `quoteAtoms*10^18/baseAtoms`,
with `price_precision = quotePrecision+18-basePrecision`; charts format them as a
virtual price token using that precision. Volumes retain the actual asset
precision. Ratios are rounded only in this display DTO, and remain nonzero at
the native 40-bit execution amount bounds even for sub-atom whole-token prices.

Focused tests cover exact rational OHLC, wide volume, sparse hour/day rollover,
exclusive paging, fixed-scale low prices and allowed intervals. Native fixtures
cover rejected-trade rollback, six days of sparse completed events with exactly
five objective rows, and seed/stop/liquidation counting without donation bars.
These analytics tests do not replace the financial invariant suite or a new CPU
measurement of the additional five current-row updates per aggregate print.
