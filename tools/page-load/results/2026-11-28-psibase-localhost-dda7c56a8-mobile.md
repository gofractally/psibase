# Page load: https://psibase.localhost:8553 (local node)

- node commit: `dda7c56a8`; script commit: `edfdbae0e`; date: 2026-11-28T09:46:51.584Z
- machine: Apple M5 Max, 18 cores, 128 GB, Darwin 25.3.0; CPU idle 80% before the run and 64% during it; Chromium 159.0.8154.6, headless
- note: node started with --http-timeout 120: with the default (4 s) the node cuts the supervisor's 1 MB component file off mid-download at this line speed and no signed-in page loads cold
- 3 cold and 3 warm loads per page; each cell is **median (min–max)**; times in seconds from the start of navigation
- cold = new browser context holding only the sign-in session; warm = the same page again in that context (README.md has the exact definition)

## Profile: mid-tier mobile: Slow 4G (562.5 ms per request, 1474.56 kbit/s down, 675 kbit/s up), CPU 4x, 412x823

| Page | Cold: first chain content | Cold: LCP | Cold: network idle | Cold: requests / KB / waves | Warm: first chain content | Warm: LCP | Warm: network idle | Warm: requests / KB / waves |
|---|---|---|---|---|---|---|---|---|
| Sign-in page | **4.69 (4.68–4.69)** | 4.70 (4.69–4.71) | 4.72 (4.72–4.72) | 11 / 120 / 7 | **2.93 (2.93–2.94)** | 2.95 (2.94–2.95) | 2.97 (2.96–2.98) | 6 / 2 / 5 |
| Signed-out app visit → sign-in | **5.25 (5.25–5.25)** | 5.27 (5.26–5.27) | 5.28 (5.28–5.29) | 12 / 121 / 8 | **3.51 (3.50–3.51)** | 3.52 (3.52–3.53) | 3.54 (3.54–3.54) | 7 / 3 / 6 |
| Home / dashboard | **34.52 (34.49–34.52)** | 33.96 (33.93–33.96) | — | 139 / 6029 / 18 | **10.76 (10.09–10.88)** | 8.92 (8.15–9.40) | — | 163 / 205 / 12 |
| Wallet (tokens) | **41.63 (41.62–43.51)** | 41.65 (41.64–43.53) | 50.76 (50.75–50.88) | 149 / 4789 / 25 | **13.51 (11.32–13.60)** | 13.54 (11.35–13.64) | 20.88 (20.51–20.93) | 142 / 53 / 18 |
| Contacts / profile | **48.35 (47.71–48.37)** | 48.37 (47.73–48.39) | 49.64 (49.63–49.64) | 151 / 4789 / 36 | **17.49 (17.38–18.03)** | 17.52 (17.41–18.06) | 18.07 (17.97–18.62) | 143 / 52 / 26 |
| Mail | **46.46 (46.45–46.50)** | 46.47 (46.46–46.52) | 47.07 (47.05–47.13) | 143 / 4787 / 33 | **16.10 (15.92–17.00)** | 16.11 (15.94–17.01) | 16.71 (16.54–17.61) | 140 / 51 / 23 |
| Name market | **50.76 (50.73–50.77)** | 33.89 (33.86–33.89) | 51.36 (51.32–51.38) | 152 / 4789 / 40 | **20.55 (20.07–21.11)** | 7.79 (7.33–8.38) | 21.14 (20.66–21.71) | 147 / 53 / 30 |
| Swap | **52.03 (52.02–52.26)** | 52.05 (52.04–52.28) | 52.02 (52.01–52.24) | 152 / 4790 / 42 | **21.88 (21.77–22.06)** | 21.90 (21.79–22.08) | 21.86 (21.76–22.05) | 148 / 54 / 32 |
| Explorer | **46.50 (46.50–46.52)** | 4.56 (4.54–4.57) | 51.88 (51.88–51.88) | 131 / 6144 / 20 | **10.32 (10.28–10.47)** | 1.47 (1.46–1.48) | 15.72 (15.66–15.89) | 127 / 227 / 11 |
| Workshop | **27.30 (27.27–27.30)** | 3.52 (3.52–3.52) | 32.75 (32.72–32.75) | 90 / 4146 / 13 | **6.09 (6.09–6.24)** | 1.31 (1.30–1.31) | 7.30 (7.30–7.46) | 82 / 32 / 7 |
| Docs | none on this page (see LCP) | **1.95 (1.95–1.95)** | 9.29 (9.29–9.42) | 33 / 959 / 7 | none on this page (see LCP) | **1.86 (1.85–1.87)** | 4.65 (4.64–4.65) | 30 / 18 / 5 |

What "first chain content" is on each page:

- Sign-in page (`supervisor.psibase.localhost:8553/sign-in.html?app=network&path=/`): form usable (name field shown and enabled)
- Signed-out app visit → sign-in (`network.psibase.localhost:8553/`): redirected, sign-in form usable
- Home / dashboard (`network.psibase.localhost:8553/`): the account's name from its profile (the hero heading); the rest of the dashboard fills in later, see network idle
- Wallet (tokens) (`network.psibase.localhost:8553/tokens`): the account's balances (or their empty state)
- Contacts / profile (`network.psibase.localhost:8553/contacts`): contact list (device data read through the supervisor; not chain data)
- Mail (`network.psibase.localhost:8553/chainmail`): conversation list (or its empty state)
- Name market (`network.psibase.localhost:8553/account-marketplace`): market state (or 'purchases are disabled')
- Swap (`network.psibase.localhost:8553/tokens/swap`): liquidity pools (or their empty state)
- Explorer (`explorer.psibase.localhost:8553/`): head block number
- Workshop (`workshop.psibase.localhost:8553/`): signed-in state from the supervisor (the app list is empty on a new account)
- Docs (`docs.psibase.localhost:8553/`): static page: LCP

### Three slowest cold loads, wave by wave

Each line is one wave: the time its first request started, how many requests, and what they were (`wasm:x` = a plugin or component file of service x, `gql:x` = a query to x, otherwise file@service). Taken from the cold load nearest the median.

**Swap** — 52.03 s, 151 requests in 42 waves before the content (33 .wasm files in the whole load)

```
@     2 ms    1  swap@network
@   586 ms    3  index-DMcc7uIB.js@network vendor-oFIhCgHA.js@network style-AgyV-iFx.css@network
@  3381 ms    1  common-lib.js@network
@  4550 ms    2  supervisor@supervisor network_logo@branding
@  5135 ms    7  main-KZoMYqyk.js@supervisor modulepreload-polyfill-B@supervisor vendor-CEx8xWzB.js@supervisor jsx-runtime-B3ozOfRH.js@supervisor preload-helper-CLcXU_4U.@supervisor guest-session-RAg7D1Lv.j@supervisor style-B_TocjL2.css@supervisor
@  6338 ms    1  common-lib.js@supervisor
@  7249 ms    6  preflight:branding wasm:supervisor×3 chainid@supervisor gql:branding
@  7856 ms   27  preflight:dyn-ld×4 preflight:accounts×2 preflight:host×3 preflight:transact×2 gql:dyn-ld×5 wasm:accounts×2 wasm:host×3 preflight:clientdata preflight:webcrypto wasm:transact×2 wasm:clientdata wasm:webcrypto
@ 20477 ms   21  preflight:dyn-ld×2 preflight:host×5 preflight:perms preflight:auth-sig preflight:vserver gql:dyn-ld×3 wasm:host×5 wasm:perms wasm:auth-sig wasm:vserver
@ 25305 ms    6  preflight:aes preflight:tokens gql:dyn-ld×2 wasm:aes wasm:tokens
@ 26779 ms    4  preflight:dyn-ld preflight:kdf gql:dyn-ld wasm:kdf
@ 27675 ms    3  gql:dyn-ld wasm:branding preflight:branding
@ 28590 ms    3  preflight:sites gql:dyn-ld wasm:sites
@ 31971 ms    2  gql:accounts preflight:accounts
@ 32593 ms    2  gql:branding preflight:branding
@ 33240 ms    1  gql:accounts
@ 33868 ms    7  preflight:profiles chainid@network gql:profiles preflight:dyn-ld preflight:network gql:dyn-ld wasm:network
@ 34444 ms    1  plmx087h4z@profiles
@ 34807 ms   15  preflight:profiles preflight:namemarket preflight:chainmail preflight:invite gql:dyn-ld×5 wasm:profiles wasm:namemarket wasm:chainmail wasm:invite wasm:token-swap preflight:token-swap
@ 37513 ms    6  preflight:credential gql:dyn-ld×2 wasm:credential wasm:base64 preflight:base64
@ 38457 ms    2  gql:accounts preflight:accounts
@ 39124 ms    2  gql:tokens preflight:tokens
@ 39760 ms    1  gql:accounts
@ 40373 ms    1  gql:tokens
@ 40989 ms    1  gql:accounts
@ 41636 ms    2  messages@chainmail preflight:chainmail
@ 42217 ms    2  gql:chainmail preflight:chainmail
@ 42863 ms    1  gql:accounts
@ 43480 ms    2  messages@chainmail preflight:chainmail
@ 44060 ms    1  gql:chainmail
@ 44663 ms    2  gql:accounts preflight:accounts
@ 45259 ms    2  gql:branding preflight:branding
@ 45904 ms    1  gql:accounts
@ 46513 ms    2  gql:tokens preflight:tokens
@ 47134 ms    1  gql:accounts
@ 47725 ms    1  gql:tokens
@ 48393 ms    1  gql:accounts
@ 48996 ms    1  gql:tokens
@ 49613 ms    1  gql:accounts
@ 50201 ms    1  gql:tokens
@ 50815 ms    2  gql:accounts preflight:accounts
@ 51432 ms    2  gql:token-swap preflight:token-swap
```

**Name market** — 50.76 s, 150 requests in 40 waves before the content (33 .wasm files in the whole load)

```
@     2 ms    1  account-marketplace@network
@   586 ms    3  index-DMcc7uIB.js@network vendor-oFIhCgHA.js@network style-AgyV-iFx.css@network
@  3373 ms    1  common-lib.js@network
@  4540 ms    2  supervisor@supervisor network_logo@branding
@  5117 ms    7  main-KZoMYqyk.js@supervisor modulepreload-polyfill-B@supervisor vendor-CEx8xWzB.js@supervisor jsx-runtime-B3ozOfRH.js@supervisor preload-helper-CLcXU_4U.@supervisor guest-session-RAg7D1Lv.j@supervisor style-B_TocjL2.css@supervisor
@  6322 ms    1  common-lib.js@supervisor
@  7232 ms    6  preflight:branding wasm:supervisor×3 chainid@supervisor gql:branding
@  7839 ms   27  preflight:dyn-ld×4 preflight:accounts×2 preflight:host×3 gql:dyn-ld×5 wasm:accounts×2 wasm:host×3 wasm:transact×2 wasm:clientdata wasm:webcrypto preflight:transact×2 preflight:clientdata preflight:webcrypto
@ 20460 ms   22  preflight:dyn-ld×3 preflight:host×5 preflight:perms preflight:auth-sig preflight:vserver gql:dyn-ld×3 wasm:host×5 wasm:perms wasm:auth-sig wasm:vserver
@ 25287 ms    6  preflight:aes preflight:tokens gql:dyn-ld×2 wasm:aes wasm:tokens
@ 26763 ms    4  preflight:dyn-ld preflight:kdf gql:dyn-ld wasm:kdf
@ 27652 ms    3  gql:dyn-ld preflight:branding wasm:branding
@ 28565 ms    3  gql:dyn-ld preflight:sites wasm:sites
@ 31945 ms    2  gql:accounts preflight:accounts
@ 32577 ms    2  gql:branding preflight:branding
@ 33212 ms    1  gql:accounts
@ 33859 ms    7  preflight:profiles chainid@network gql:profiles preflight:dyn-ld gql:dyn-ld wasm:network preflight:network
@ 34436 ms    1  plmx087h4z@profiles
@ 34811 ms   15  preflight:profiles preflight:namemarket preflight:chainmail preflight:invite preflight:token-swap gql:dyn-ld×5 wasm:profiles wasm:namemarket wasm:chainmail wasm:invite wasm:token-swap
@ 37512 ms    6  preflight:credential preflight:base64 gql:dyn-ld×2 wasm:credential wasm:base64
@ 38467 ms    2  gql:accounts preflight:accounts
@ 39122 ms    2  gql:tokens preflight:tokens
@ 39760 ms    1  gql:accounts
@ 40378 ms    1  gql:tokens
@ 40991 ms    1  gql:accounts
@ 41615 ms    2  messages@chainmail preflight:chainmail
@ 42201 ms    2  gql:chainmail preflight:chainmail
@ 42827 ms    1  gql:accounts
@ 43418 ms    2  messages@chainmail preflight:chainmail
@ 43996 ms    1  gql:chainmail
@ 44659 ms    2  gql:accounts preflight:accounts
@ 45260 ms    2  gql:branding preflight:branding
@ 45886 ms    1  gql:accounts
@ 46505 ms    2  gql:tokens preflight:tokens
@ 47109 ms    1  gql:accounts
@ 47717 ms    2  gql:namemarket preflight:namemarket
@ 48326 ms    1  gql:accounts
@ 48924 ms    1  gql:namemarket
@ 49530 ms    1  gql:tokens
@ 50181 ms    2  gql:accounts preflight:accounts
```

**Contacts / profile** — 48.35 s, 145 requests in 36 waves before the content (33 .wasm files in the whole load)

```
@     2 ms    1  contacts@network
@   586 ms    3  index-DMcc7uIB.js@network vendor-oFIhCgHA.js@network style-AgyV-iFx.css@network
@  3382 ms    1  common-lib.js@network
@  4543 ms    2  supervisor@supervisor network_logo@branding
@  5127 ms    7  main-KZoMYqyk.js@supervisor modulepreload-polyfill-B@supervisor vendor-CEx8xWzB.js@supervisor jsx-runtime-B3ozOfRH.js@supervisor preload-helper-CLcXU_4U.@supervisor guest-session-RAg7D1Lv.j@supervisor style-B_TocjL2.css@supervisor
@  6329 ms    1  common-lib.js@supervisor
@  7240 ms    6  preflight:branding wasm:supervisor×3 chainid@supervisor gql:branding
@  7856 ms   28  preflight:dyn-ld×5 preflight:accounts×2 preflight:host×3 gql:dyn-ld×5 wasm:accounts×2 wasm:host×3 wasm:transact×2 wasm:clientdata wasm:webcrypto preflight:transact×2 preflight:clientdata preflight:webcrypto
@ 20461 ms   22  preflight:dyn-ld×3 preflight:host×5 preflight:perms preflight:auth-sig preflight:vserver gql:dyn-ld×3 wasm:host×5 wasm:perms wasm:auth-sig wasm:vserver
@ 25288 ms    6  preflight:aes gql:dyn-ld×2 wasm:aes wasm:tokens preflight:tokens
@ 26763 ms    4  preflight:dyn-ld gql:dyn-ld wasm:kdf preflight:kdf
@ 27656 ms    3  preflight:branding gql:dyn-ld wasm:branding
@ 28574 ms    3  preflight:sites gql:dyn-ld wasm:sites
@ 31951 ms    2  gql:accounts preflight:accounts
@ 32576 ms    2  gql:branding preflight:branding
@ 33213 ms    1  gql:accounts
@ 33862 ms    7  preflight:profiles chainid@network gql:profiles preflight:dyn-ld preflight:network gql:dyn-ld wasm:network
@ 34434 ms    1  plmx087h4z@profiles
@ 34805 ms   15  preflight:profiles preflight:namemarket preflight:chainmail preflight:invite preflight:token-swap gql:dyn-ld×5 wasm:profiles wasm:namemarket wasm:chainmail wasm:invite wasm:token-swap
@ 37515 ms    6  preflight:credential preflight:base64 gql:dyn-ld×2 wasm:credential wasm:base64
@ 38465 ms    2  gql:accounts preflight:accounts
@ 39119 ms    2  gql:tokens preflight:tokens
@ 39758 ms    1  gql:accounts
@ 40373 ms    1  gql:tokens
@ 40988 ms    1  gql:accounts
@ 41598 ms    2  messages@chainmail preflight:chainmail
@ 42183 ms    2  gql:chainmail preflight:chainmail
@ 42821 ms    1  gql:accounts
@ 43421 ms    2  messages@chainmail preflight:chainmail
@ 44003 ms    1  gql:chainmail
@ 44617 ms    2  gql:accounts preflight:accounts
@ 45225 ms    2  gql:branding preflight:branding
@ 45858 ms    1  gql:accounts
@ 46464 ms    2  gql:tokens preflight:tokens
@ 47077 ms    1  gql:accounts
@ 47767 ms    1  gql:accounts
```

## Not measured

- Wallet transfer confirmation prompt: needs a token balance to reach; a new account on a freshly booted chain has none, and this script sends no transactions
- Exchange: not in the DevDefault package set
- Bitcoin bridge: not in the DevDefault package set
