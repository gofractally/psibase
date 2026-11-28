# Page load: https://psiber.net (REAL NETWORK (figures vary with the line that day))

- node commit: `deployed-2026-11-28`; script commit: `edfdbae0e`; date: 2026-11-28T10:18:33.803Z
- machine: Apple M5 Max, 18 cores, 128 GB, Darwin 25.3.0; CPU idle 77% before the run and 70% during it; Chromium 159.0.8154.6, headless
- 3 cold and 3 warm loads per page; each cell is **median (min–max)**; times in seconds from the start of navigation
- cold = new browser context holding only the sign-in session; warm = the same page again in that context (README.md has the exact definition)

## Profile: desktop, the line as it is (no delay added), no CPU throttle

| Page | Cold: first chain content | Cold: LCP | Cold: network idle | Cold: requests / KB / waves | Warm: first chain content | Warm: LCP | Warm: network idle | Warm: requests / KB / waves |
|---|---|---|---|---|---|---|---|---|
| Sign-in page | **1.34 (1.31–1.47)** | 1.35 (1.33–1.49) | 1.38 (1.35–1.52) | 11 / 116 / 7 | **0.37 (0.35–0.37)** | 0.39 (0.37–0.39) | 0.41 (0.40–0.42) | 6 / 0 / 5 |
| Signed-out app visit → sign-in | **1.37 (1.31–1.43)** | 1.38 (1.31–1.44) | 1.42 (1.35–1.48) | 12 / 116 / 8 | **0.45 (0.44–0.49)** | 0.48 (0.46–0.50) | 0.49 (0.48–0.53) | 7 / 0 / 6 |

What "first chain content" is on each page:

- Sign-in page (`supervisor.psiber.net/sign-in.html?app=psibernet&path=/`): form usable (name field shown and enabled)
- Signed-out app visit → sign-in (`psibernet.psiber.net/`): redirected, sign-in form usable

### Three slowest cold loads, wave by wave

Each line is one wave: the time its first request started, how many requests, and what they were (`wasm:x` = a plugin or component file of service x, `gql:x` = a query to x, otherwise file@service). Taken from the cold load nearest the median.

**Signed-out app visit → sign-in** — 1.37 s, 12 requests in 8 waves before the content (0 .wasm files in the whole load)

```
@     1 ms    1  psibernet@psibernet
@   387 ms    1  sign-in.html@supervisor
@   533 ms    5  sign-in-tYu3-Mf-.js@supervisor modulepreload-polyfill-B@supervisor preload-helper-CLcXU_4U.@supervisor guest-session-RAg7D1Lv.j@supervisor style-B_TocjL2.css@supervisor
@   680 ms    1  common-lib.js@supervisor
@   817 ms    1  chainid@supervisor
@   883 ms    1  rootdomain@homepage
@  1221 ms    1  rootdomain@psibernet
@  1299 ms    1  rootdomain@psibernet
```

**Sign-in page** — 1.34 s, 12 requests in 7 waves before the content (0 .wasm files in the whole load)

```
@     4 ms    1  sign-in.html@supervisor
@   383 ms    5  sign-in-tYu3-Mf-.js@supervisor modulepreload-polyfill-B@supervisor preload-helper-CLcXU_4U.@supervisor guest-session-RAg7D1Lv.j@supervisor style-B_TocjL2.css@supervisor
@   515 ms    1  common-lib.js@supervisor
@   641 ms    2  chainid@supervisor favicon.ico@supervisor
@   706 ms    1  rootdomain@homepage
@  1075 ms    1  rootdomain@psibernet
@  1267 ms    1  rootdomain@psibernet
```

