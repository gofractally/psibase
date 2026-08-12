# Banx

Mutual-credit ledger: credit lines, deposits (auto-net), multi-hop path payments, and debtor-posted FX/rebook policies. There is no local cash balance — value is obligations between accounts.

**Routing** is same-asset only (fixed + percent hop fee). **Currency changes on `path_pay`** auto-apply the previous edge debtor's **currency policy** (convert), then continue with same-asset routing.

## Architecture

| Layer | Role |
|-------|------|
| **service** | Tables + actions (`st_crd_lne`, `deposit`, `path_pay`, `st_rte_pol`, `st_cur_pol`, `convert`, `net`, `accrue`) |
| **r-banx** | GraphQL: assets, credit lines, obligations, policies |
| **plugin** | WIT `api` methods apps call via Supervisor |
| **ui** | React app on the `banx` subdomain |

## UI routes

- `/obligations` — **Accounts** (first nav item): savings-style claims you hold + loan-style liabilities you owe
- `/` — dashboard (exposure snapshot)
- `/path-pay` — multi-hop draw
- `/policies` — routing + currency policies + convert
- `/assets` — registered assets

Amounts in the UI are **human decimals** (e.g. `"1.45"`). The Banx plugin looks up asset precision via GraphQL and converts with `Quantity::from_str`. Helpers: `helpers.decimalToQuantity` / `helpers.quantityToDecimal`. APR is entered as percent and stored as ppm (`10_000` ppm = 1%). FX/`fx_rate` uses `RATE_SCALE` (`1_000_000` = 1:1).

## Build

```bash
# UI
cd packages/user/Banx/ui && yarn && yarn build

# Package (from Banx root)
cargo-psibase package
```

Install with `cargo-psibase install` against a local psinode. Open `https://banx.<root>/`. GraphiQL: `/graphiql`.

## Test

```bash
cargo-psibase test   # from packages/user/Banx/service
```
