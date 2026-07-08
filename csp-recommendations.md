# Content Security Policy Recommendations

Security review deliverable for tightening the Content-Security-Policy (CSP)
headers served to psibase web apps.

Reference: <https://infosec.mozilla.org/guidelines/web_security.html>

## Goal

Replace today's single permissive baseline with a **strict-by-default** policy,
and enumerate the small set of apps that legitimately need a looser policy.
Every CSP below is the strictest policy that still lets the app function, given
the platform architecture verified in the codebase (last verified against
`main`, July 2026).

## Assumptions

1. **Host injection.** `sites` can inject, per request, the request's own
   origin (covered by `'self'`) and the deployment **root domain** `{root}`,
   derived by stripping the leading service label from the request `Host`
   header. All subdomains are `<service>.{root}`. This is the main engineering
   item this review depends on, but the primitives already exist:
   `Sites::serveSys` already calls `to<HttpServer>().rootHost(request.host)` at
   the point the CSP is assembled, and `HttpServer::getSiblingUrl` already
   demonstrates deriving the scheme (`forwardedProto` → `isSecure(socket)` →
   `isLocalhost`) and preserving the port (`hostHeaderPortSuffix`). Note
   `rootHost` does **not** include the port, so origins are built as
   `scheme + rootHost + portSuffix`, mirroring `getSiblingUrl`. See the
   dev/localhost note under Watch list for the recommended scheme-relative form.
2. **CSP is replace, not merge.** In the current `sites` implementation
   (`Sites::getCspHeader`), a per-path or per-site CSP **completely replaces**
   the default — the values are not merged. Therefore every exception below must
   be stated as a *complete* policy, not a delta.
3. **Strictness target.** Where a choice exists, we pick the strictest value
   that does not break a verified use, and rely on the existing `setCsp` action
   for app developers to opt into anything looser.
4. **Rollout.** Ship first as `Content-Security-Policy-Report-Only` with a
   reporting endpoint, then enforce. Tightening the default retroactively
   affects any already-deployed third-party app that never called `setCsp`, so
   this is a breaking change and needs a migration/communication plan.

---

## Recommended default CSP

Applies to the **majority** of Sites (any normal first-party or third-party web
app that renders UI and talks to the platform).

```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data: {root} *.{root};
font-src 'self';
connect-src 'self' {root} *.{root};
frame-src supervisor.{root};
frame-ancestors 'self';
base-uri 'none';
form-action 'self';
object-src 'none';
```

As a single header value:

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: {root} *.{root}; font-src 'self'; connect-src 'self' {root} *.{root}; frame-src supervisor.{root}; frame-ancestors 'self'; base-uri 'none'; form-action 'self'; object-src 'none';
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
| `img-src` | `'self' data: {root} *.{root}` | `data:` for generated identicons (dicebear `toDataUri`) and base64 app icons (Workshop). `{root} *.{root}` because user avatars are uploaded to each account's own subdomain (`sites` path `/profile/avatar`, see `Profiles` plugin) and loaded **cross-subdomain** by the shared `Avatar` component (Homepage contacts/tokens, etc.). Arbitrary off-domain images still require per-app opt-in. |
| `font-src` | `'self'` | Fonts are self-hosted; no CDN font usage found. |
| `connect-src` | `'self' {root} *.{root}` | Apps `fetch` GraphQL/RPC directly from sibling subdomains (e.g. `transact`, `branding`, `invite`, `dyn-ld`). `'self'` also covers same-origin WebSockets. Supervisor comms is `postMessage`, which CSP does not govern. The apex `{root}` is listed explicitly because `*.{root}` does not match the bare root domain. |
| `frame-src` | `supervisor.{root}` | The only iframe a normal app mounts is the hidden supervisor iframe injected by `@psibase/common-lib`. |
| `frame-ancestors` | `'self'` | Normal app pages are not meant to be embedded cross-origin (clickjacking defense). Apps that expose a prompt page override this — see exceptions. |
| `base-uri` | `'none'` | Nothing sets `<base>`; blocks `<base>`-injection that would redirect relative resource loads. |
| `form-action` | `'self'` | Apps submit via `fetch`, not native cross-origin form posts. |
| `object-src` | `'none'` | No `<object>`/`<embed>` usage. |

### Sites covered by the default

These apps have no special requirement and should receive the default policy:

- `homepage` (Homepage — network root app; also hosts the Chainmail, Contacts,
  and Tokens sub-apps in one SPA)
- `config` (Config)
- `identity` (Identity)
- `evaluations` (Evaluations)
- `fractals` (Fractals)
- `fractal-cr` (FractalCore)
- `token-stream` (TokenStream)
- `prem-accounts` (PremAccounts)
- `workshop` (Workshop)
- `common-api` (CommonApi; also serves the plugin-tester dev tool under
  `/common/plugin-tester/` — it is part of this site, not its own subdomain)

A few service-only packages (`branding`, `chainmail`, `guilds`, `tokens`)
declare `data` uploads in their `Cargo.toml` but have no in-tree UI source
(the standalone Chainmail UI now lives inside Homepage); whatever static
content they serve also falls under the default.

Explorer and Docs also exist on this branch but need exceptions (see below)
because their build tooling emits inline scripts.

---

## Exceptions

Five Sites need a policy other than the default. Each is stated as a complete
replacement policy (per assumption 2).

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
img-src 'self' data: {root} *.{root};
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

Recommended (site-wide) policy = default, with `frame-ancestors` widened:

```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data: {root} *.{root};
font-src 'self';
connect-src 'self' {root} *.{root};
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
img-src 'self' data: {root} *.{root};
font-src 'self';
connect-src 'self' {root} *.{root};
frame-src supervisor.{root};
frame-ancestors supervisor.{root};
base-uri 'none';
form-action 'self';
object-src 'none';
```

> Current `packages/user/Permissions/postinstall.json` sets only
> `frame-ancestors *`. Since CSP is replace-not-merge, that override currently
> *removes* the default policy from the prompt page entirely and replaces it
> with a single (permissive) directive. Adopting the full policy above both
> tightens `frame-ancestors` and restores the rest of the protections on that
> page.

### 4. Explorer (`explorer`) — SvelteKit inline bootstrap script

Explorer is the only SvelteKit app (`@sveltejs/adapter-static`,
`packages/user/Explorer/ui/svelte.config.js`). Unlike the Vite/React apps,
its built pages contain an **inline `<script>`** that bootstraps the app
(`__sveltekit_* = {...}; Promise.all([import("/_app/immutable/entry/...")])`).
The script's content embeds content-hashed asset paths, so it **changes every
build** — a hardcoded hash source is not maintainable by hand.

Recommended (site-wide) policy = default, with a build-time script hash:

```
default-src 'self';
script-src 'self' 'sha256-{explorer-inline-script-hash}';
style-src 'self' 'unsafe-inline';
img-src 'self' data: {root} *.{root};
font-src 'self';
connect-src 'self' {root} *.{root};
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
- Unlike the app default, Docs does **not** embed the supervisor or fetch from
  sibling subdomains (it doesn't use `common-lib` at all), so `connect-src`
  and `frame-src` are tighter than the default here.
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

Recommended admin policy (same-origin WebSocket is covered by `'self'`):

```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data:;
font-src 'self';
connect-src 'self' {root} *.{root};
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

- **`img-src` for external images.** The known first-party case (cross-subdomain
  avatars at `<account>.{root}/profile/avatar`) is now covered by
  `{root} *.{root}` in the default. Truly external images (arbitrary
  user-supplied URLs, off-domain token icons/NFT art) remain blocked by default
  and need per-app opt-in via `setCsp`; re-audit if such a feature ships.
- **Explorer hash automation.** Exception 4 depends on computing the SvelteKit
  inline-script hash at build/packaging time and injecting it into Explorer's
  `setCsp`. Until that automation exists, Explorer needs the `'unsafe-inline'`
  fallback.
- **Docs: vendor MathJax and Mermaid.** Serving MathJax (and its fonts) and
  Mermaid from the `docs` site itself would remove `cdnjs.cloudflare.com` and
  `cdn.jsdelivr.net` from Exception 5 — the only third-party origins remaining
  in any recommended policy.
- **`'wasm-unsafe-eval'` vs `'unsafe-eval'` (supervisor).** Confirm jco
  instantiation works with the narrower `'wasm-unsafe-eval'`; fall back only if
  runtime errors appear.
- **`style-src 'unsafe-inline'`.** Removable only via per-response style nonces,
  which conflicts with `sites`' static hosting + ETag caching. Out of scope for
  the first pass.
- **Apex vs. subdomain.** `*.{root}` does not match the bare `{root}`; keep the
  explicit apex `{root}` entry alongside the `*.{root}` wildcard in
  `connect-src`/`frame-src` wherever apps may hit the root domain.
- **Dev / localhost.** Local origins are `http://` with ports (e.g.
  `http://config.psibase.localhost:8080`). `'self'` already covers the app's own
  origin — including scheme, host, and port — so same-origin scripts (the
  external `/common/common-lib.js` module served same-origin by `Sites::serveSys`),
  styles, `fetch`, and WebSockets work locally with no special handling. Only the
  cross-origin directives (`connect-src`, `frame-src`) need the scheme and port
  filled in. The **scheme-relative** notation used throughout this document
  handles that automatically: with `{root}` = `psibase.localhost:8080`, the
  default resolves to
  `connect-src 'self' psibase.localhost:8080 *.psibase.localhost:8080;` and
  `frame-src supervisor.psibase.localhost:8080;`, which adopt the page's `http`
  scheme locally and `https` in prod — so only host+port needs injecting (from
  `rootHost` + `hostHeaderPortSuffix`). If a future implementation pins schemes
  explicitly instead, reuse the exact scheme derivation from
  `HttpServer::getSiblingUrl` (`forwardedProto` → `isSecure(socket)` →
  `isLocalhost`) so TLS-terminating reverse proxies get `https` sources via
  `X-Forwarded-Proto` rather than the plaintext socket scheme. The Vite dev
  server (port `8081`) is a separate origin not served by `sites`, so its
  HMR/`eval`/inline scripts are unaffected by this CSP.
- **Optional hardening.** Add `upgrade-insecure-requests` on non-localhost
  deployments only — it must be suppressed locally (it would try to upgrade
  `http://…localhost:8080` to `https` and break dev). Gate it on the existing
  `isLocalhost` check (already used for the cookie `Secure` flag in
  `CommonApi.cpp`). `require-trusted-types-for 'script'` is aspirational — it
  needs app-side Trusted Types adoption first.
- **Backward compatibility.** Roll out via `Content-Security-Policy-Report-Only`
  with a reporting endpoint before enforcing.

---

## Summary table

| Site | Service account | Policy | Scope | Reason |
| --- | --- | --- | --- | --- |
| Homepage, Config, Identity, Evaluations, Fractals, FractalCore, TokenStream, PremAccounts, Workshop, CommonApi (incl. plugin-tester) | various | **Default** | site-wide | No special needs |
| Supervisor | `supervisor` | Exception 1 | site-wide | Wasm/blob, embeds prompts, embedded by all apps |
| Accounts | `accounts` | Exception 2 | site-wide (SPA) | Serves prompt pages embedded by supervisor |
| Permissions | `perms` | Exception 3 | path (`/plugin/web/prompt/permissions/index.html`) | Serves a prompt page embedded by supervisor |
| Explorer | `explorer` | Exception 4 | site-wide | SvelteKit inline bootstrap script (per-build hash) |
| Docs | `docs` | Exception 5 | site-wide | mdbook inline scripts + MathJax (cdnjs) and Mermaid (jsdelivr) CDNs |
| XAdmin, XProxy | `x-admin`, `x-proxy` | Admin policy | via `x-sites` | Admin panels; `x-sites` has no default-CSP mechanism (gap) |
