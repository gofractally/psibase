# Page-load measurement (gofractally/psibase#2315)

The target is **every page loads in 2 seconds or less**, cold. This directory
holds the script that produces the numbers quoted on the issue, so that a
number in a commit message can be reproduced by anyone.

It lives in `tools/page-load/` rather than beside the Supervisor's e2e scripts
because it measures every app, not the Supervisor, and it carries its own
`package.json` (the e2e scripts have none and were run from a scratch
directory).

## Run it

```sh
cd tools/page-load
npm install                      # playwright-core only
npx playwright-core install chromium   # once per machine, if Chromium is missing

# a throwaway chain from an existing build (no build is started)
./boot-chain.sh ~/psibase-pssz-build 8553        # prints the chain dir and the PID

node page-load.mjs --target https://psibase.localhost:8553 --commit <commit the node was built from> --profile both

kill <pid printed by boot-chain.sh>              # stop the node when done
```

Output: a markdown table on stdout, and `results/<date>-<host>-<commit>-<profiles>.md`
and `.json` (every single load, its waves and its request counts). The files
of the first baseline are committed in `results/`.

| Option | Default | Meaning |
|---|---|---|
| `--target URL` | `https://psibase.localhost:8553` | root of the deployment; apps are at `<app>.<host>` |
| `--commit X` | `unknown` | label only: the commit the node and its packages were built from |
| `--profile` | `desktop` | `desktop`, `mobile` or `both` |
| `--repeats N` | 5 (3 for a remote target) | cold loads and warm loads per page |
| `--delay MS` | 150 (0 for a remote target) | fixed delay added to every request, desktop profile |
| `--delay-method` | `proxy` | `proxy`, or `route` (the earlier profile scripts' way, see below) |
| `--pages a,b` | all | only these page ids |
| `--account`, `--key-file` | — | remote target: an existing account and its key file |
| `--home-app` | `network` locally | subdomain of the network's home app (required for a remote target, e.g. `psibernet`) |
| `--out DIR`, `--tag T` | `results/` | where the files go; a suffix for their names |
| `--timeout S` | 90 | how long to wait for a page's content before recording a failure |
| `--force` | off | run although the machine is busy |

### Against a real deployment

```sh
node page-load.mjs --target https://psiber.net --home-app psibernet \
     --account probetest1 --key-file /path/to/probetest1.key.pem --commit <deployed commit>
```

Read-only: it signs in with the key file and navigates; it sends no
transaction. Without `--account`/`--key-file` only the two signed-out pages are
measured. No delay is added (the line has its own), three repeats by default.
These are **real-network figures: they vary with the line and the hour**, and
are a second column, never the reference.

## What is measured

Each page is loaded `N` times **cold** and `N` times **warm**; every cell is the
**median (min–max)**. Times are seconds from the start of the navigation.

- **Cold** — a brand-new browser context: empty HTTP cache, empty memory and
  compiled-code caches, no service worker, no Cache Storage. For a signed-in
  page it is seeded with only what sign-in produced: the session cookies, and
  the supervisor origin's localStorage and IndexedDB (account list, passkey
  session, device key, the supervisor's encrypted per-plugin data) — **minus**
  `psibase.plugin-graph.v1`, the record of which plugins each app used last
  time, which exists only after an earlier visit and drives the plugin
  prefetch. Nothing fetched or compiled during sign-in is carried over, so this
  is slightly colder than a person who signed in a minute ago (their HTTP cache
  already holds the supervisor's files and the plugins sign-in used).
- **Warm** — the same page again in the same context, in a new tab, as soon as
  the cold load has gone idle. HTTP cache, storage and the plugin record are
  whatever the cold load left.
- **Signed out** (sign-in page, redirect): cold is an empty context.

Columns:

| Column | Meaning |
|---|---|
| **first chain content** | the primary number (#2315): navigation start → the page's first content that came from the chain is on screen. Each page's condition is in the `PAGES` table in `page-load.mjs`, with a comment saying why it only becomes true after a query has answered. It is checked inside the page in the animation frame after every DOM change. No app is modified. |
| LCP | Largest Contentful Paint of the final document, on the same clock. On these pages it is often static chrome painted before any data, which is why it is not the primary number. For a page with nothing from the chain (Docs) it is the primary number. |
| network idle | the moment the last request finished, once nothing has been in flight for 500 ms, looked for from the content marker onwards. "—" if the page never goes quiet within 15 s (polling). |
| requests | requests that reached the network up to network idle, **including CORS preflights** and revalidations (a file the browser holds but asks the node about again is a round trip, and is counted; the protocol reports it as a 200, so they are not counted separately); taken from the DevTools protocol (Playwright's own request events omit preflights). Answers from the browser cache are not counted. |
| KB | bytes received over the network for those requests (headers and compressed bodies). |
| waves | sequential round trips before the content: request starts more than 60 ms apart begin a new wave (the rule `profile-waves.mjs` used). With a fixed delay per request, content cannot appear before `waves × delay`. |

The JSON also has, per load: preflights, cache hits, `.wasm` files,
requests before the content, every wave with what was in it, and
`requestsSeenByProxy` (the delay proxy's own count, a cross-check of
`requests`).

## Network conditions

- **desktop** — 1280×1000, no CPU throttling, a **fixed delay (150 ms) added to
  every request that reaches the network**. This is the repeatable reference.
- **mobile** — "Slow 4G" exactly as Lighthouse 13.6 and Chrome DevTools define
  it (`mobileSlow4G` in devtools-frontend
  `front_end/models/trace/lantern/simulation/Constants.ts`, checked
  2026-11-28): 150 ms RTT and 1.6 Mbit/s, applied at the request level as
  562.5 ms per request, 1474.56 kbit/s down, 675 kbit/s up, through CDP
  `Network.emulateNetworkConditions`; CPU slowed 4× (`Emulation.setCPUThrottlingRate`);
  Lighthouse's mobile screen (412×823 at 1.75). No extra delay is added.

How the fixed delay is applied: a small TLS pass-through inside the script
holds each request for the delay and forwards it to the node untouched; the
browser is pointed at it with `--host-resolver-rules`, so URLs, cookies and
Host headers are the node's own. It needs the certificate the node serves
(`--tls-cert`, `--tls-key`; default the developer CA in `~/.psibase-dev-ca`).

The earlier profile scripts added the delay with Playwright's `context.route`.
While a route is installed Playwright **switches the browser's HTTP cache off**
(a "repeat load" re-downloads everything) and **answers CORS preflights itself**
(they cost nothing, where a browser pays a round trip for each). Numbers taken
that way are therefore lower than a browser would see and blind to caching:
on the baseline build the dashboard's cold first content is 3.21 s with
`route` and 4.54 s through the proxy. `--delay-method route` keeps that method
available only for comparing with figures taken that way.

### The mobile profile needs a longer node timeout

With psinode's default configuration (`http-timeout = 4s`) the node closes a
response that is still being sent after roughly ten seconds. At Slow 4G the
supervisor's 1 MB component file takes longer than that while it shares the
line with the other downloads, the browser reports
`ERR_CONTENT_LENGTH_MISMATCH`, and a cold signed-in page never loads.
(`curl --limit-rate 60k` on that file shows the same cut without a browser.)
To get mobile numbers at all, boot the chain with

```sh
PSINODE_ARGS="--http-timeout 120" ./boot-chain.sh ~/psibase-pssz-build 8553
```

and say so beside the figures. The desktop profile is not affected.

### Keeping the numbers repeatable

- The script refuses to start when less than half the CPU is idle (`--force`
  overrides, and the output then says the machine was busy). Under another
  job's load the same page took twice as long, erratically; on a quiet machine
  five cold loads of the dashboard fell within 60 ms of each other.
- Every load records `undelayed`: requests that finished sooner than the
  profile's per-request latency. It should be empty or nearly so. Known
  entries: Docs fetches MathJax from cdnjs.cloudflare.com, which the local
  delay does not reach; under the mobile profile about 8 of 150 requests per
  load (queries that follow a preflight) are reported in 2–3 ms.
- `requestsSeenByProxy` should equal `requests` (it does to within one or two
  cancelled fetches).
- Run one profile at a time and nothing else heavy beside it. Stop the script
  with `kill <pid>`; it closes its browser.

## Adding a page

Add an entry to `PAGES` in `page-load.mjs`:

```js
{
    id: "my-page", title: "My page", signedIn: true,
    app: "my-app",                 // subdomain; "home" = the network's home app
    path: () => "/",
    // why this is only true once chain data is on screen:
    marker: { selector: "…", text: "regex", absent: "regex", visible: true },
    what: "what the reader should understand the first content to be",
},
```

`marker` is true when `selector` exists (default `body`; `visible`/`enabled`
are optional checks on it), its text matches `text`, and the page's text does
not match `absent`. Choose something the app renders only after its query has
answered — a value, a row, or the empty state that replaces a skeleton — and
make it match both the empty and the populated state. If nothing on the page
comes from the chain, set `marker: null` and LCP is used. A new subdomain is
entered automatically at sign-in. Run `--pages my-page --repeats 1` and check
that the time is neither the shell's nor a timeout.

## Quoting numbers in commit messages

From #2315: every commit that changes a page's load time references the issue
and states **page, condition, before → after**, for example

```
Homepage, cold, desktop +150 ms: 4.9 s → 2.1 s first chain content

Refs gofractally/psibase#2315
```

Use the median of this script's "first chain content" (or LCP for a page that
has none), name the profile and cold or warm, and take before and after on the
same machine in the same session. A page meets the target when its **cold**
number is ≤ 2 s. Post the full table as a comment on the issue, with the
commit that was measured.
