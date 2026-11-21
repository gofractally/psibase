# Deployed native wallet and candle validation

The demo is running at <http://exchange.psibase.localhost:8089/>. Native Host,
Supervisor, Tokens and Exchange components handle account connection, transfer
review and native transactions. The development HTTP wallet on 8090 is stopped
and is no longer started by `demo/run.py`. The off-browser market bot remains
running independently.

## Browser transactions completed

Alice/Bob local demo accounts were used for actual native transactions:

* Exact one-off USD 1.2345 deposit, with trust initially unchecked.
* Changed-amount review and denial with no balance change.
* USD 0.5 deposit with remembered trust, then USD 0.25 without another prompt.
* Trust revocation, followed by a fresh review; denial again changes no funds.
* USD 0.9845 withdrawal through a fresh Tokens review.
* Market7 USD 1 buy: 771 satoshis received, above the 763-satoshi minimum.
* A limit order reserves USD 10; cancellation restores all USD 10 exactly.
* Alice/Bob switching shows only the selected wallet's assets and native
  exchange transfer history. Failed/denied attempts create no transfer rows.
* Hourly/daily candles and volume, desktop/mobile layouts and live main-market
  updates were visually checked. The browser is left on Alice/main market1.

The completed money flows net to USD 1 traded for 771 satoshis. Committed
positions finish unchanged. Exact intermediate values and verification limits
are in [the browser report](../../packages/user/Exchange/ui/qa/NATIVE-WALLET.md).

The optional AuthSig account creation reached key-backup confirmation, which
automation did not complete. No protected key value was bypassed or logged.
All unused test funding was returned to its source. Browser financial coverage
is for the native Alice/Bob demo accounts, not an AuthSig-signature claim.

## Request handling fixes

* Private Exchange routes require the canonical Exchange host and authenticated
  owner. Tokens retains public metadata but denies private projections under
  another registered host and for another authenticated wallet.
* Supervisor CORS matches the platform's full sibling origin, including its
  port. Authorization is explicitly allowed in preflight; arbitrary siblings
  and a different port receive no allow-origin grant.
* HttpServer strips all issued/legacy session credentials and Authorization
  headers after authentication, before application code receives the request.
* Native prompt pages have scoped framing policies. HostPrompt checks prompt
  ownership, and Permissions checks the selected account and active app.
* Sites revalidation returns current CSP/no-cache on 304 without changing file
  bytes or ETags. Prompt assets use a normal application asset path rather than
  the node's reserved `/native/` prefix.

Native DTO handling now accepts immutable tokens with no administrator, and
the Exchange publication hook accepts a properly pinned Tokens-only withdrawal
while retaining ordinary Exchange-action requirements for execution/preparation.

## Candle state and history

Intervals are 5s, 15s, 1m, 1h and 1d. Only the current candle for each interval
is retained in objective `CurrentCandleTable` at index15: at most five rows per
traded market. Completed nonempty candles are native **prunable history events**,
queried through bounded market indexes and opaque event-ID pagination.

The recorder stores exact OHLC ratios and wide volumes. Native tests advance
six days, verify completed hourly/daily history, and retain exactly five current
rows. Rejected transactions roll back both candle writes and events. Coverage
starts at this recorder's deployment; older bars are not fabricated. See
[CANDLES.md](CANDLES.md).

## Recorded checks

| Check | Result |
|---|---|
| UI semantic tests | 31 passed |
| Native WASM selection | 12 passed, including 10 actual-chain fixtures |
| Expanded Exchange/Tokens host/owner fixture | 1 passed |
| Exchange client planner/publication tests | 18 passed |
| Candle arithmetic/page tests | 5 passed |
| Immutable/administered metadata decode | 1 passed |
| HttpServer production helper checks | 15 passed |
| Live HttpServer request checks | 8 passed |
| CommonApi endpoint checks | 12 passed |
| Supervisor tests | 8 passed |
| Existing Python helper suite | 57 passed |

Sites conditional-policy checks and new prompt scope checks also pass. These
counts describe their respective scopes; they are not a whole-system coverage
percentage or a production financial certification.

Deployment/source fingerprints are in `demo/native-wallet-deployment.json`,
`demo/native-candles-deployment.json` and the CommonApi/HttpServer/Sites build
reports. Native results are in `demo/native-wallet-and-candles-tests.json` and
`demo/native-private-owner-tests.json`. Final live asset, framing, CORS, owner
and candle checks are recorded in `demo/native-wallet-final-http.json`.
