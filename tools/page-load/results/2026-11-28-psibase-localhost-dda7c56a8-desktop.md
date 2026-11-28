# Page load: https://psibase.localhost:8553 (local node)

- node commit: `dda7c56a8`; script commit: `edfdbae0e`; date: 2026-11-28T09:33:41.377Z
- machine: Apple M5 Max, 18 cores, 128 GB, Darwin 25.3.0; CPU idle 72% before the run and 64% during it; Chromium 159.0.8154.6, headless
- 5 cold and 5 warm loads per page; each cell is **median (min–max)**; times in seconds from the start of navigation
- cold = new browser context holding only the sign-in session; warm = the same page again in that context (README.md has the exact definition)

## Profile: desktop, +150 ms per request (proxy), no CPU throttle

| Page | Cold: first chain content | Cold: LCP | Cold: network idle | Cold: requests / KB / waves | Warm: first chain content | Warm: LCP | Warm: network idle | Warm: requests / KB / waves |
|---|---|---|---|---|---|---|---|---|
| Sign-in page | **1.10 (1.09–1.11)** | 1.11 (1.10–1.12) | 1.14 (1.14–1.16) | 11 / 121 / 7 | **0.79 (0.79–0.80)** | 0.81 (0.80–0.82) | 0.83 (0.83–0.84) | 6 / 3 / 5 |
| Signed-out app visit → sign-in | **1.26 (1.24–1.26)** | 1.27 (1.25–1.28) | 1.29 (1.29–1.30) | 12 / 121 / 8 | **0.95 (0.94–0.95)** | 0.96 (0.95–0.97) | 0.99 (0.98–0.99) | 7 / 3 / 6 |
| Home / dashboard | **4.54 (4.48–4.54)** | 4.19 (4.19–4.22) | 15.04 (14.87–15.21) | 186 / 6772 / 18 | **3.34 (3.18–3.37)** | 2.75 (2.44–2.79) | 10.31 (10.15–10.34) | 190 / 370 / 12 |
| Wallet (tokens) | **6.18 (6.17–6.94)** | 6.20 (6.19–6.96) | 9.48 (9.47–9.49) | 142 / 4794 / 25 | **4.06 (3.13–4.21)** | 4.08 (3.16–4.23) | 6.43 (6.43–6.43) | 144 / 58 / 18 |
| Contacts / profile | **8.54 (8.38–8.54)** | 9.07 (9.06–9.08) | 9.03 (9.02–9.03) | 142 / 4794 / 36 | **5.49 (5.49–5.63)** | 5.70 (5.69–5.83) | 5.64 (5.63–5.78) | 141 / 56 / 26 |
| Mail | **8.04 (8.04–9.22)** | 4.19 (4.18–5.37) | 8.21 (8.20–9.38) | 134 / 4792 / 33 | **5.14 (4.68–5.16)** | 2.30 (2.21–2.46) | 5.31 (5.30–5.47) | 135 / 55 / 23 |
| Name market | **9.31 (9.29–9.32)** | 9.32 (9.31–9.33) | 9.31 (9.29–9.31) | 141 / 4794 / 39 | **6.26 (6.26–6.27)** | 6.29 (6.27–6.30) | 6.26 (6.25–6.27) | 143 / 57 / 29 |
| Swap | **9.81 (9.78–9.95)** | 9.83 (9.80–9.96) | 9.80 (9.78–9.94) | 144 / 4795 / 42 | **6.75 (6.75–6.76)** | 6.77 (6.76–6.79) | 6.75 (6.74–6.75) | 146 / 59 / 32 |
| Explorer | **5.60 (5.58–5.61)** | 0.58 (0.57–0.59) | 7.39 (7.38–7.40) | 126 / 6147 / 20 | **3.01 (3.00–3.14)** | 0.43 (0.42–0.43) | 4.80 (4.79–4.96) | 123 / 230 / 11 |
| Workshop | **3.16 (3.15–3.21)** | 0.51 (0.51–0.55) | 4.12 (4.11–4.17) | 86 / 4150 / 13 | **1.50 (1.49–1.76)** | 0.36 (0.36–0.37) | 1.97 (1.96–2.25) | 46 / 34 / 7 |
| Docs | none on this page (see LCP) | **0.78 (0.78–0.79)** | 1.76 (1.70–1.82) | 33 / 961 / 7 | none on this page (see LCP) | **0.78 (0.77–0.79)** | 1.23 (1.23–1.24) | 30 / 19 / 5 |

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

**Swap** — 9.81 s, 144 requests in 42 waves before the content (33 .wasm files in the whole load)

```
@     3 ms    1  swap@network
@   162 ms    3  index-DMcc7uIB.js@network vendor-oFIhCgHA.js@network style-AgyV-iFx.css@network
@   330 ms    1  common-lib.js@network
@   551 ms    2  supervisor@supervisor network_logo@branding
@   707 ms    7  main-KZoMYqyk.js@supervisor modulepreload-polyfill-B@supervisor vendor-CEx8xWzB.js@supervisor jsx-runtime-B3ozOfRH.js@supervisor preload-helper-CLcXU_4U.@supervisor guest-session-RAg7D1Lv.j@supervisor style-B_TocjL2.css@supervisor
@   864 ms    1  common-lib.js@supervisor
@  1022 ms    6  preflight:branding wasm:supervisor×3 chainid@supervisor gql:branding
@  1329 ms   28  preflight:dyn-ld×5 gql:dyn-ld×5 wasm:accounts×2 wasm:host×3 wasm:transact×2 wasm:clientdata wasm:webcrypto preflight:accounts×2 preflight:host×3 preflight:transact×2 preflight:clientdata preflight:webcrypto
@  1773 ms   19  gql:dyn-ld×3 wasm:host×5 wasm:perms wasm:auth-sig wasm:vserver preflight:host×5 preflight:perms preflight:auth-sig preflight:vserver
@  2182 ms    6  gql:dyn-ld×2 wasm:aes wasm:tokens preflight:aes preflight:tokens
@  2518 ms    3  gql:dyn-ld wasm:kdf preflight:kdf
@  2866 ms    3  gql:dyn-ld wasm:branding preflight:branding
@  3181 ms    3  gql:dyn-ld wasm:sites preflight:sites
@  3525 ms    2  gql:accounts preflight:accounts
@  3839 ms    1  gql:branding
@  4005 ms    1  gql:accounts
@  4169 ms    6  preflight:profiles chainid@network gql:profiles gql:dyn-ld wasm:network preflight:network
@  4324 ms    1  plmx07qjfi@profiles
@  4502 ms   15  gql:dyn-ld×5 wasm:profiles wasm:namemarket wasm:chainmail wasm:invite wasm:token-swap preflight:profiles preflight:namemarket preflight:chainmail preflight:invite preflight:token-swap
@  4869 ms    6  gql:dyn-ld×2 wasm:credential wasm:base64 preflight:credential preflight:base64
@  5195 ms    1  gql:accounts
@  5366 ms    2  gql:tokens preflight:tokens
@  5682 ms    1  gql:accounts
@  5840 ms    1  gql:tokens
@  6017 ms    1  gql:accounts
@  6181 ms    2  messages@chainmail preflight:chainmail
@  6487 ms    2  gql:chainmail preflight:chainmail
@  6800 ms    1  gql:accounts
@  6961 ms    2  messages@chainmail preflight:chainmail
@  7268 ms    1  gql:chainmail
@  7428 ms    1  gql:accounts
@  7584 ms    2  gql:branding preflight:branding
@  7895 ms    1  gql:accounts
@  8052 ms    1  gql:tokens
@  8228 ms    1  gql:accounts
@  8384 ms    1  gql:tokens
@  8545 ms    1  gql:accounts
@  8702 ms    1  gql:tokens
@  8862 ms    2  gql:accounts preflight:accounts
@  9171 ms    1  gql:tokens
@  9331 ms    1  gql:accounts
@  9489 ms    2  gql:token-swap preflight:token-swap
```

**Name market** — 9.31 s, 141 requests in 39 waves before the content (33 .wasm files in the whole load)

```
@     2 ms    1  account-marketplace@network
@   161 ms    3  index-DMcc7uIB.js@network vendor-oFIhCgHA.js@network style-AgyV-iFx.css@network
@   331 ms    1  common-lib.js@network
@   550 ms    2  supervisor@supervisor network_logo@branding
@   704 ms    7  main-KZoMYqyk.js@supervisor modulepreload-polyfill-B@supervisor vendor-CEx8xWzB.js@supervisor jsx-runtime-B3ozOfRH.js@supervisor preload-helper-CLcXU_4U.@supervisor guest-session-RAg7D1Lv.j@supervisor style-B_TocjL2.css@supervisor
@   860 ms    1  common-lib.js@supervisor
@  1022 ms    6  preflight:branding wasm:supervisor×3 chainid@supervisor gql:branding
@  1328 ms   28  preflight:dyn-ld×5 preflight:accounts×2 gql:dyn-ld×5 wasm:accounts×2 wasm:host×3 wasm:transact×2 wasm:clientdata wasm:webcrypto preflight:host×3 preflight:transact×2 preflight:clientdata preflight:webcrypto
@  1771 ms   19  gql:dyn-ld×3 wasm:host×5 wasm:perms wasm:auth-sig wasm:vserver preflight:host×5 preflight:perms preflight:auth-sig preflight:vserver
@  2182 ms    6  gql:dyn-ld×2 wasm:aes wasm:tokens preflight:aes preflight:tokens
@  2519 ms    3  gql:dyn-ld wasm:kdf preflight:kdf
@  2865 ms    3  gql:dyn-ld wasm:branding preflight:branding
@  3180 ms    3  gql:dyn-ld wasm:sites preflight:sites
@  3517 ms    2  gql:accounts preflight:accounts
@  3831 ms    1  gql:branding
@  3998 ms    1  gql:accounts
@  4163 ms    6  preflight:profiles chainid@network gql:profiles gql:dyn-ld wasm:network preflight:network
@  4318 ms    1  plmx07qjfi@profiles
@  4501 ms   15  gql:dyn-ld×5 wasm:profiles wasm:namemarket wasm:chainmail wasm:invite wasm:token-swap preflight:profiles preflight:namemarket preflight:chainmail preflight:invite preflight:token-swap
@  4869 ms    6  gql:dyn-ld×2 wasm:credential wasm:base64 preflight:credential preflight:base64
@  5196 ms    1  gql:accounts
@  5365 ms    2  gql:tokens preflight:tokens
@  5682 ms    1  gql:accounts
@  5839 ms    1  gql:tokens
@  6017 ms    1  gql:accounts
@  6176 ms    2  messages@chainmail preflight:chainmail
@  6484 ms    2  gql:chainmail preflight:chainmail
@  6797 ms    1  gql:accounts
@  6953 ms    2  messages@chainmail preflight:chainmail
@  7260 ms    1  gql:chainmail
@  7420 ms    1  gql:accounts
@  7576 ms    2  gql:branding preflight:branding
@  7889 ms    1  gql:accounts
@  8044 ms    1  gql:tokens
@  8219 ms    1  gql:accounts
@  8376 ms    2  gql:namemarket preflight:namemarket
@  8687 ms    2  gql:accounts preflight:accounts
@  8996 ms    1  gql:namemarket
@  9151 ms    1  gql:tokens
```

**Contacts / profile** — 8.54 s, 136 requests in 36 waves before the content (33 .wasm files in the whole load)

```
@     2 ms    1  contacts@network
@   159 ms    3  index-DMcc7uIB.js@network vendor-oFIhCgHA.js@network style-AgyV-iFx.css@network
@   327 ms    1  common-lib.js@network
@   546 ms    2  supervisor@supervisor network_logo@branding
@   701 ms    7  main-KZoMYqyk.js@supervisor modulepreload-polyfill-B@supervisor vendor-CEx8xWzB.js@supervisor jsx-runtime-B3ozOfRH.js@supervisor preload-helper-CLcXU_4U.@supervisor guest-session-RAg7D1Lv.j@supervisor style-B_TocjL2.css@supervisor
@   859 ms    1  common-lib.js@supervisor
@  1017 ms    6  preflight:branding wasm:supervisor×3 chainid@supervisor gql:branding
@  1323 ms   28  preflight:dyn-ld×5 preflight:accounts×2 gql:dyn-ld×5 wasm:accounts×2 wasm:host×3 wasm:transact×2 wasm:clientdata wasm:webcrypto preflight:host×3 preflight:transact×2 preflight:clientdata preflight:webcrypto
@  1764 ms   19  gql:dyn-ld×3 wasm:host×5 wasm:perms wasm:auth-sig wasm:vserver preflight:host×5 preflight:perms preflight:auth-sig preflight:vserver
@  2172 ms    6  gql:dyn-ld×2 wasm:aes wasm:tokens preflight:aes preflight:tokens
@  2511 ms    3  gql:dyn-ld wasm:kdf preflight:kdf
@  2860 ms    3  gql:dyn-ld wasm:branding preflight:branding
@  3174 ms    3  gql:dyn-ld wasm:sites preflight:sites
@  3513 ms    2  gql:accounts preflight:accounts
@  3827 ms    1  gql:branding
@  3993 ms    1  gql:accounts
@  4158 ms    6  preflight:profiles chainid@network gql:profiles gql:dyn-ld wasm:network preflight:network
@  4312 ms    1  plmx07qjfi@profiles
@  4491 ms   15  gql:dyn-ld×5 wasm:profiles wasm:namemarket wasm:chainmail wasm:invite wasm:token-swap preflight:profiles preflight:namemarket preflight:chainmail preflight:invite preflight:token-swap
@  4863 ms    6  gql:dyn-ld×2 wasm:credential wasm:base64 preflight:credential preflight:base64
@  5187 ms    1  gql:accounts
@  5357 ms    2  gql:tokens preflight:tokens
@  5672 ms    1  gql:accounts
@  5829 ms    1  gql:tokens
@  6006 ms    1  gql:accounts
@  6165 ms    2  messages@chainmail preflight:chainmail
@  6472 ms    2  gql:chainmail preflight:chainmail
@  6784 ms    1  gql:accounts
@  6941 ms    2  messages@chainmail preflight:chainmail
@  7250 ms    1  gql:chainmail
@  7410 ms    1  gql:accounts
@  7565 ms    2  gql:branding preflight:branding
@  7878 ms    1  gql:accounts
@  8034 ms    1  gql:tokens
@  8209 ms    1  gql:accounts
@  8384 ms    1  gql:accounts
```

## Not measured

- Wallet transfer confirmation prompt: needs a token balance to reach; a new account on a freshly booted chain has none, and this script sends no transactions
- Exchange: not in the DevDefault package set
- Bitcoin bridge: not in the DevDefault package set
