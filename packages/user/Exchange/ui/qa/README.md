# Initial financial browser verification

See [NATIVE-HOST.md](NATIVE-HOST.md) for the later native-account hosting,
OHLC/volume, depth zoom, responsive layout, and measured live-update checks.

Verified against the running native Psibase chain at
`http://127.0.0.1:8090/`, using visible Google Chrome through computer use.
Every financial action below was submitted through the UI and confirmed by
the native chain bridge. No browser-side exchange simulation was used.

* Alice deposited 10 USD and withdrew 10 USD; her native wallet returned to
  its original 800,000 USD.
* A passive bid at 90,000 USD/BTC committed 90 USD and displayed exactly
  0.001 BTC in the book. Cancelling it removed that order and returned
  the full committed 90 USD.
* A market buy spent 100 USD and credited 0.00099999 BTC. Relay reserves and
  its displayed price changed immediately.
* Borrowing one long-loan unit at the existing 80,000 trigger coalesced the
  seeded position from 100 to 101 units. Repaying one unit restored its
  100-unit / 800 USD face debt and released the added 0.0002 BTC collateral.
  The round trip paid the specified 0.08 USD financing charge.
* A 10 USD lending deposit minted 99,999 shares; redeeming all of them
  returned 9.9999 USD, consistent with conservative native atom rounding.
* Minting 1,000 relay LP shares and redeeming them succeeded while the
  existing credit remained covered. Conservative redemption retained one
  native atom of each asset in the relay.
* Permissionless market creation funded an independent second BTC/USD book,
  market **#7**, with 0.001 BTC and 100 USD. The interface selected the new
  market by its confirmed returned ID and displayed its independent reserves.
* Switching to Bob showed his own 0.5 BTC ask and no margin positions; Alice's
  private position was absent. The interface was returned to Alice and #1.

The native service's ID sequence includes pool and loan generations, so the
second market correctly received ID 7 rather than ID 2.

Desktop and a 390 CSS-pixel phone viewport were visually checked. A narrower
312 CSS-pixel viewport was also checked and has no horizontal page overflow.
The temporary viewport override was reset. Browser console warnings/errors
were empty. Responsive overflow and tiny-relay axis rounding found during
QA were fixed and the static assets rebuilt.

At the end of that initial session, the browser was left open on Alice's BTC/USD **market #1**, with the seeded
100-unit loan and original 99,000 bid preserved. The live tab is marked as
a deliverable. `desktop.jpg` and `mobile.jpg` capture the final native state.

Additional desktop checks verified the actual CSS viewport, page scroll width,
right order panel, and wallet selector at each requested width:

| Viewport width | Page scroll width | Order panel right | Wallet selector right |
|---:|---:|---:|---:|
| 1280 | 1280 | 1252 | 1250 |
| 1366 | 1366 | 1338.4 | 1336.4 |
| 1440 | 1440 | 1411.99 | 1410 |

All three columns fit without horizontal page overflow. The former full-page
browser capture was cropped by Chrome's zoom factor; it was replaced with
the native CUA capture. Image dimensions were independently checked:
`desktop.jpg` is 1645×921, `desktop-1440.jpg` is 1440×900, and `mobile.jpg` is
390×843. Raw layout measurements are in `viewport-checks.json`. Temporary
viewport overrides were reset after verification.

Subsequent real devnet activity has changed the price, filled orders, and
liquidated the seeded position. These recorded balances describe the initial
verification, not the current continuously trading state.

These are local development tokens and demo identities, not real BTC or USD
financial transactions. The UI's thirteen unit tests separately cover exact
amount conversion, uint64 and commitment limits, relay estimates, XSS escaping,
native credit-capability/funding gates, exact asset-based order and liquidity
inputs, cumulative depth, actual OHLC/volume aggregation, depth zoom, and
native-host wallet routing.
