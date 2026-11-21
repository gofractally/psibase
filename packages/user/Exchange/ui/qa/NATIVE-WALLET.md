# Native wallet browser verification

Observed through Chrome tab 1697463706 against local Psibase on 2026-11-21.
The demo wallet bridge on port 8090 is stopped; connection attempts fail.
Native URL: `http://exchange.psibase.localhost:8089/`.
These are controlled devnet transactions, not production funds or an audit.

## Completed native cases

- Named-account UI and native Host Alice/Bob AuthAny selection, sign-in and
  switching work. No fixed development wallet adapter is involved.
- Spot, Margin, Deposit and Withdraw are neighboring ticket tabs. Assets,
  native transfer history and Tokens permissions are in the account dialog.
- Alice's initial Tokens trust was false. The exact USD 1.2345 deposit review
  displayed Alice, exchange, token 2, amount, direction and memo. Trust was
  unchecked. Authorizing just that transfer eventually published one native
  deposit, with exact wallet/exchange deltas below.
- A different amount, USD 0.0001, required a new review. Cancel returned without
  a transaction or any balance change.
- USD 0.5 was approved with the native Tokens Trust exchange checkbox checked.
  The account menu reported trusted permission. A subsequent USD 0.25 deposit
  completed with no prompt, with the exact separate delta below.
- A quiet market 7 USD 1 market buy completed natively, protected by a minimum
  receive of 763 satoshis. Actual output was 771 satoshis. Its native daily
  candle and base volume reflect that actual execution.
- Revoking trust changed the native status to per-transfer approval. Another
  USD 0.0001 deposit opened a fresh, unchecked review; Cancel preserved balances.
- After revocation, USD 0.9845 withdrawal required an exact native Tokens review
  in the reverse direction. One-off authorization published the withdrawal;
  wallet increased and available exchange balance decreased by exactly 0.9845.
- Native Tokens USD history showed the three successful deposits and completed
  withdrawal. Denied reviews and failed pre-publication attempts added no
  transfer rows. History is honestly labeled transfers; this is not a complete
  persistent order/fill audit.
- Native Bob connection showed Bob's distinct wallet/assets and only his own
  USD 200000 initial transfer, without Alice's 1.2345/0.5/0.25 rows. Switching back
  restored Alice's own transfer history.
- A native market 7 limit buy for 0.0001 BTC at USD 100000 reserved exactly
  USD 10: available 151374.3009 to 151364.3009 and committed 5 to 15. Cancel
  removed the order and restored both amounts exactly, without moving wallets.
- Native 1h and 1d chart selections render actual OHLC and BTC volume with UTC
  labels. History begins at deployment, so these initially contain one current
  bar. Market7's first actual trade created its first bar; no fictitious bars
  were inserted for empty periods.

## Exact balance evidence

BTC wallet stayed 8 throughout. USD committed stayed 5 and BTC committed stayed
0.025 throughout the following completed transactions.

| State | USD wallet | USD available | BTC available |
|---|---:|---:|---:|
| Baseline | 800000 | 151374.3009 | 2.46478201 |
| Deposit 1.2345 | 799998.7655 | 151375.5354 | 2.46478201 |
| Denied 0.0001 | 799998.7655 | 151375.5354 | 2.46478201 |
| Deposit 0.5 with trust | 799998.2655 | 151376.0354 | 2.46478201 |
| Deposit 0.25 without prompt | 799998.0155 | 151376.2854 | 2.46478201 |
| Market7 buy for 1 USD | 799998.0155 | 151375.2854 | 2.46478972 |
| Denied after revoke | 799998.0155 | 151375.2854 | 2.46478972 |
| Withdraw 0.9845 | 799999 | 151374.3009 | 2.46478972 |

The net transfer was 1 USD into the exchange, then 1 USD bought 771 satoshis. USD
available therefore returned exactly to baseline while BTC available rose 771
satoshis. Read-only views and history were used to verify every completed delta.

## Bugs discovered and repaired during browser integration

Deployment mismatches were repaired in the native platform: missing DynLd
mappings/current Invite/Credentials/NameMarket/VServer components; native
CommonApi cookie endpoint; exact Supervisor CORS and canonical-host binding;
HttpServer case-sensitive cookie/bearer stripping and Vary support; nullable
burned Tokens admin metadata; native prompt asset path and CSP/304 policy.

The first withdrawal attempt caught an Exchange publication guard incorrectly
requiring an Exchange action for a ready-cash withdrawal containing only Tokens
actions. It failed before publication with all balances unchanged. The repaired
operation-specific guard passed 18 host tests, was deployed, and the exact
withdrawal then passed through a fresh native prompt.

## Limits and unfinished observations

Native Host successfully created AuthSig account `exchsigner`, then required
key-backup confirmation. Browser automation's clipboard bridge failed and
password values were redacted; that protection was respected. Confirmation and
an AuthSig-signed Exchange transaction were not completed. No private key was
logged, exported, or included in screenshots. Alice/Bob tests use devnet AuthAny;
they do not establish production ECDSA signing coverage.

Desktop and mobile layout, native limit placement/cancellation, hourly/daily
selection and symmetric depth zoom passed. At 390×844 the Assets dialog measured
370×601 with no horizontal document overflow. Long transfer history stayed
within an 824px dialog and scrolled internally. Viewport overrides were reset.
The initial pass lacked 200 completed 5-second bars. The later pagination
follow-up verified actual Older/Latest native candle navigation; see PAGINATION.md.
The main market 1 Spot ticket and live 5s chart/volume were left open under Alice
at the native URL above. No money operation or approval remained pending.

All unused funding sent to the unconfirmed AuthSig account was returned by root;
no demo assets were stranded. Its signing limitation remains explicit above.

Previous responsive observations (temporary overrides reset afterwards):

| Viewport | Document width | Document height | Evidence |
|---|---:|---:|---|
| 390×844 | 390 | 2052 | stacked panels; no horizontal overflow |
| 920×800 | 920 | 1050 | order panel 201px, content 150px; no artificial 925px minimum |

The initial native-wallet UI suite passed 31 tests; the current suite count is
recorded in PAGINATION.md. The portfolio process-CPU benchmark
and remaining production read-model limitations are documented separately in
`docs/exchange/UI_API_REVIEW.md`.

## Exchange-only bounded pagination follow-up

The replacement UI was built with 38 passing tests, then deployed with matching
Exchange service/query/plugin components. Source and deployment hashes are in
`build-exchange-pagination/deployment.json`.

Browser observations after deployment:

- `/?market=7` opened the exact native market, independently of discovery.
- Markets showed the actual two live books (IDs 1 and 7), with exact-ID search.
  Entering 1 selected the main market. The live catalog is smaller than a UI page;
  real catalog continuation and large-cardinality cases are tested separately.
- Default depth displayed the nearest 14 orders independently on each side.
  More sell orders expanded to 20 asks and More buy orders to 24 bids. Expanded
  rows persisted across automatic polling and were labeled as a page view.
  Refresh depth returned to current nearest rows.
- Assets used the native owner page and token-ID 2 point lookup. Labels explicitly
  describe shown available/reserved amounts and their selected-market scope.
- Global own Positions displayed limit orders, active loans, lending, liquidity
  and stop orders with their referenced market/token metadata. Alice's all-market
  margin view showed the 400 USD loan in market 1; filtering market 7 returned zero.
- Switching to Bob replaced private rows and cash with Bob's own values: his
  armed stop showed 0.0025 BTC rather than Alice's 0.005 BTC. Switching back restored
  Alice. Neither the account pages nor their historical values feed live funding
  arithmetic.

The live dataset does not contain more than 200 rows in a family, so native
large-cardinality fixtures and unit request-epoch tests cover those continuations.
Those fixtures are separate from this live browser smoke. No claim is made that
browser automation traversed a 1000-row owner portfolio on the demo chain.

The final pagination browser and exact-target cancellation evidence is in
[PAGINATION.md](PAGINATION.md).
