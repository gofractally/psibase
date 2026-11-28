# Page load: https://psibase.localhost:8553 (local node)

- node commit: `dda7c56a8`; script commit: `edfdbae0e`; date: 2026-11-28T10:16:29.253Z
- machine: Apple M5 Max, 18 cores, 128 GB, Darwin 25.3.0; CPU idle 66% before the run and 63% during it; Chromium 159.0.8154.6, headless
- 3 cold and 3 warm loads per page; each cell is **median (min–max)**; times in seconds from the start of navigation
- cold = new browser context holding only the sign-in session; warm = the same page again in that context (README.md has the exact definition)

## Profile: desktop, +150 ms per request (route), no CPU throttle

| Page | Cold: first chain content | Cold: LCP | Cold: network idle | Cold: requests / KB / waves | Warm: first chain content | Warm: LCP | Warm: network idle | Warm: requests / KB / waves |
|---|---|---|---|---|---|---|---|---|
| Home / dashboard | **3.21 (3.21–3.21)** | 3.00 (3.00–3.01) | 10.52 (10.49–10.52) | 230 / 6765 / 18 | **2.90 (2.90–2.90)** | 2.47 (2.31–2.47) | 8.40 (8.37–8.40) | 230 / 6765 / 14 |
| Wallet (tokens) | **4.87 (4.85–4.98)** | 4.90 (4.88–5.00) | 6.80 (6.77–6.92) | 174 / 4789 / 27 | **3.63 (3.63–3.63)** | 3.65 (3.65–3.66) | 5.56 (5.55–5.56) | 174 / 4789 / 20 |

What "first chain content" is on each page:

- Home / dashboard (`network.psibase.localhost:8553/`): the account's name from its profile (the hero heading); the rest of the dashboard fills in later, see network idle
- Wallet (tokens) (`network.psibase.localhost:8553/tokens`): the account's balances (or their empty state)

### Three slowest cold loads, wave by wave

Each line is one wave: the time its first request started, how many requests, and what they were (`wasm:x` = a plugin or component file of service x, `gql:x` = a query to x, otherwise file@service). Taken from the cold load nearest the median.

**Wallet (tokens)** — 4.87 s, 150 requests in 27 waves before the content (33 .wasm files in the whole load)

```
@     2 ms    1  tokens@network
@   159 ms    3  index-DMcc7uIB.js@network vendor-oFIhCgHA.js@network style-AgyV-iFx.css@network
@   332 ms    1  common-lib.js@network
@   550 ms    3  supervisor@supervisor network_logo@branding favicon.ico@network
@   706 ms    7  main-KZoMYqyk.js@supervisor modulepreload-polyfill-B@supervisor vendor-CEx8xWzB.js@supervisor jsx-runtime-B3ozOfRH.js@supervisor preload-helper-CLcXU_4U.@supervisor guest-session-RAg7D1Lv.j@supervisor style-B_TocjL2.css@supervisor
@   864 ms    1  common-lib.js@supervisor
@  1028 ms    6  preflight:branding wasm:supervisor×3 chainid@supervisor gql:branding
@  1184 ms   28  gql:dyn-ld×5 wasm:accounts×2 wasm:host×3 wasm:transact×2 wasm:clientdata wasm:webcrypto preflight:dyn-ld×5 preflight:accounts×2 preflight:host×3 preflight:transact×2 preflight:clientdata preflight:webcrypto
@  1484 ms   22  preflight:dyn-ld×3 preflight:host×5 gql:dyn-ld×3 wasm:host×5 wasm:perms wasm:auth-sig wasm:vserver preflight:perms preflight:auth-sig preflight:vserver
@  1747 ms    8  preflight:dyn-ld×2 gql:dyn-ld×2 wasm:aes wasm:tokens preflight:aes preflight:tokens
@  1933 ms    4  preflight:dyn-ld gql:dyn-ld wasm:kdf preflight:kdf
@  2129 ms    4  preflight:dyn-ld gql:dyn-ld wasm:branding preflight:branding
@  2297 ms    4  preflight:dyn-ld gql:dyn-ld wasm:sites preflight:sites
@  2483 ms    2  gql:accounts preflight:accounts
@  2645 ms    2  gql:branding preflight:branding
@  2812 ms    2  gql:accounts preflight:accounts
@  2980 ms    7  preflight:profiles chainid@network gql:profiles preflight:dyn-ld gql:dyn-ld wasm:network preflight:network
@  3136 ms   21  plmx099ksr@profiles preflight:dyn-ld×5 gql:dyn-ld×5 wasm:profiles wasm:namemarket wasm:chainmail wasm:invite wasm:token-swap preflight:profiles preflight:namemarket preflight:chainmail preflight:invite preflight:token-swap
@  3385 ms    8  preflight:dyn-ld×2 gql:dyn-ld×2 wasm:credential wasm:base64 preflight:credential preflight:base64
@  3561 ms    2  gql:accounts preflight:accounts
@  3731 ms    2  gql:tokens preflight:tokens
@  3899 ms    2  gql:accounts preflight:accounts
@  4056 ms    2  gql:tokens preflight:tokens
@  4234 ms    2  gql:accounts preflight:accounts
@  4400 ms    2  messages@chainmail preflight:chainmail
@  4555 ms    2  gql:chainmail preflight:chainmail
@  4718 ms    2  gql:accounts preflight:accounts
```

**Home / dashboard** — 3.21 s, 110 requests in 18 waves before the content (41 .wasm files in the whole load)

```
@     1 ms    1  network@network
@   160 ms    3  index-DMcc7uIB.js@network vendor-oFIhCgHA.js@network style-AgyV-iFx.css@network
@   333 ms    1  common-lib.js@network
@   553 ms    3  supervisor@supervisor network_logo@branding favicon.ico@network
@   709 ms    7  main-KZoMYqyk.js@supervisor modulepreload-polyfill-B@supervisor vendor-CEx8xWzB.js@supervisor jsx-runtime-B3ozOfRH.js@supervisor preload-helper-CLcXU_4U.@supervisor guest-session-RAg7D1Lv.j@supervisor style-B_TocjL2.css@supervisor
@   866 ms    1  common-lib.js@supervisor
@  1027 ms    6  preflight:branding wasm:supervisor×3 chainid@supervisor gql:branding
@  1184 ms   28  gql:dyn-ld×5 wasm:accounts×2 wasm:host×3 wasm:transact×2 wasm:clientdata wasm:webcrypto preflight:dyn-ld×5 preflight:accounts×2 preflight:host×3 preflight:transact×2 preflight:clientdata preflight:webcrypto
@  1487 ms   22  preflight:dyn-ld×3 preflight:host×5 preflight:perms gql:dyn-ld×3 wasm:host×5 wasm:perms wasm:auth-sig wasm:vserver preflight:auth-sig preflight:vserver
@  1747 ms    8  preflight:dyn-ld×2 preflight:aes gql:dyn-ld×2 wasm:aes wasm:tokens preflight:tokens
@  1932 ms    4  preflight:dyn-ld gql:dyn-ld wasm:kdf preflight:kdf
@  2126 ms    4  preflight:dyn-ld gql:dyn-ld wasm:branding preflight:branding
@  2289 ms    4  preflight:dyn-ld gql:dyn-ld wasm:sites preflight:sites
@  2475 ms    2  gql:accounts preflight:accounts
@  2639 ms    2  gql:branding preflight:branding
@  2806 ms    2  gql:accounts preflight:accounts
@  2971 ms    7  preflight:dyn-ld gql:dyn-ld wasm:packages preflight:packages preflight:profiles chainid@network gql:profiles
@  3193 ms    5  preflight:dyn-ld gql:dyn-ld wasm:setcode preflight:setcode plmx099ksr@profiles
```

## Not measured

- Wallet transfer confirmation prompt: needs a token balance to reach; a new account on a freshly booted chain has none, and this script sends no transactions
- Exchange: not in the DevDefault package set
- Bitcoin bridge: not in the DevDefault package set
