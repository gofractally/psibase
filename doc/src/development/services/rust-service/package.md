# Building Packages

A [psibase package](../../../specifications/data-formats/package.md) may be composed of one or more crates. It can be built by `cargo psibase package` or installed on a running chain with `cargo psibase install`.

`cargo psibase` reads the `[package.metadata.psibase]` section of `Cargo.toml`. At the minimum, `package-name` must be specified.

## Available fields

In the top-level crate:

- `package-name`: Required.
- `services`: A list of **Cargo crate names** (dependency keys) to include in the psibase package — not on-chain account names. See [Package naming](#package-naming) below.

In any crate that builds a service:

- `server`: The value is a crate which will handle HTTP requests sent to this service. The other crate will be built and included in the current package. If HTTP requests are handled in the base service, it should reference the service. Can be omitted if service serves no HTTP requests.
- `plugin`: The value is a crate that should be built with `cargo component` and uploaded as `/plugin.wasm`
- `flags`: [Flags](../../../specifications/data-formats/package.md#serviceservicejson) for the service.
- `data`: An array of `{src, dst}` paths to upload to the service's subdomain. `src` is relative to the location of Cargo.toml. If `src` is a directory, its contents will be included recursively.

In top-level crate or any crate that builds a service:

- `postinstall`: An array of actions to run when the package is installed. Actions from a single `postinstall` will be run in order. The order of actions from multiple crates is unspecified.
- `dependencies`: Additional packages, not build by cargo, that the package depends on.

## Example

./Cargo.toml

```toml
[package]
name = "example"
version = "0.1.0"
description = "An example package"

[package.metadata.psibase]
# (required) Builds example.psi (<package-name>.psi (case-sensitive))
package-name = "example"
# package includes `service1` service
services = ["service1"]

[package.metadata.psibase.dependencies]
HttpServer = "0.23.0"
```

./service/Cargo.toml

```toml
[package]
name = "service1"
version = "0.1.0"
description = "A service to be included in the package"

[package.metadata.psibase]
# Most services besides the core system services don't need extra flags.
flags = []
# This service handles its own HTTP requests
server = "service1"
# Plugin for the front end
plugin = "service1-plugin"
# Upload the UI
data = [{src = "../ui/dist", dst = "/"}]
# Run the service's init action; "0000" represents <no args> from the Fracpack perspective.
postinstall = [{sender="service1", service="service1", method="init", rawData="0000"}]
```

## Package naming

A psibase app uses **many different names** for the same project. Most are **build-time**
(Cargo, WIT, CMake). A smaller set are **on-chain** (account names used by actions,
GraphQL, plugins, and trust/permissions).

These layers are easy to conflate because:

- Cargo and WIT prefer **kebab-case** (`name-market`, `token-swap`).
- On-chain accounts are **short strings** (max **10 characters**) and often omit
  hyphens when a hyphenated name would not fit.
- The `[package.metadata.psibase] services` field is named misleadingly: it lists
  **Cargo crate names**, not on-chain account names.

The sections below explain what each name is, where it is defined, and what it must
correlate with.

### Quick reference

| Identifier | Example (NameMarket) | Example (TokenSwap) | Namespace | Must correlate with |
|------------|----------------------|---------------------|-----------|---------------------|
| Repo directory | `NameMarket/` | `TokenSwap/` | Filesystem | CMake `PATH`, workspace member path (convention: PascalCase) |
| Published package | `NameMarket` | `TokenSwap` | `.psi` artifact | `package-name` in root `Cargo.toml`; output `NameMarket.psi` |
| Package crate | `name-market-pkg` | `token-swap-pkg` | Cargo | Root `[package].name`; suffix `-pkg` (convention) |
| Service crate | `name-market` | `token-swap` | Cargo | Root `[dependencies]` key; `services = ["…"]` entry |
| On-chain service account | `namemarket` | `token-swap` | Chain | `#[psibase::service(name = "…")]`; `postinstall` sender/service; GraphQL `service:`; trust whitelists |
| Query crate | `r-name-market` | `r-token-swap` | Cargo | Service `server = "r-…"`; prefix `r-` (convention) |
| On-chain query account | `namemarket+1` | `token-swap+1` | Chain | `#[psibase::service(name = "…+1")]` in query-service |
| Plugin crate | `name-market-plugin` | `token-swap-plugin` | Cargo | Service `plugin = "…-plugin"` |
| WIT component package | `name-market:plugin` | `token-swap:plugin` | WIT / WASM | `package` in `plugin/wit/*.wit` and `[package.metadata.component]` |
| Rust service module | `name_market` | `token_swap` | Rust source | Crate name with `-` → `_` (Cargo + `use` in plugin/tests) |
| WIT bindings module | `name_market::plugin` | `token_swap::plugin` | Generated Rust | WIT package before `:plugin`, `-` → `_` |
| Package dependency | `HttpServer` | `Tokens` | Published `.psi` | `[package.metadata.psibase.dependencies]` keys |
| Cross-plugin WIT dep key | `name-market:plugin` | `transact:plugin` | WIT imports | `[package.metadata.component.target.dependencies]` in consumer plugin |

### Build time vs on-chain

```text
BUILD TIME (Cargo / WIT / CMake)          RUNTIME (on-chain)
────────────────────────────────          ────────────────────
name-market-pkg                           (not deployed)
  ├─ name-market        ───────────────►  namemarket
  ├─ r-name-market      ───────────────►  namemarket+1
  └─ name-market-plugin ──WIT──────────►  /plugin.wasm on namemarket subdomain
       name-market:plugin
```

- **Left side** names are how `cargo-psibase`, `cargo component`, and the workspace
  wire crates together.
- **Right side** names are what the chain, HTTP server, GraphQL, and other plugins
  actually call.

When a kebab-case name fits in 10 characters, build-time and on-chain names can
match (TokenSwap). When it does not, they intentionally diverge (NameMarket).

### On-chain account names (requirements)

Defined by `#[psibase::service(name = "…")]` and used in:

- `postinstall` actions (`sender`, `service` fields)
- GraphQL routing (`graphql(…, { service: "…" })`)
- Plugin trust whitelists (`whitelist = ["accounts", "homepage"]` — these are
  **service account names**, not WIT package names)
- Cross-service calls and event indexes

**Rules** (see `rust/psibase_names/src/account_number.rs`):

- Length **0–10 characters** (empty string is valid but unused for services).
- Characters: `a–z`, `0–9`, `-` (hyphen allowed).
- Must not start or end with `-`, and must not contain `--`.
- Query / RPC sibling: base name + `+N` (convention is `+1`), e.g. `namemarket+1`.

Hyphens are **allowed** on-chain (`token-swap` is 9 characters). They are not
required. Choose a name that fits the 10-character limit; abbreviate or concatenate
when a readable hyphenated form does not fit (`namemarket` vs `name-market`).

### Build-time names (by artifact)

#### Published package name

```toml
# <App>/Cargo.toml
[package.metadata.psibase]
package-name = "NameMarket"
```

- **Produces** `NameMarket.psi` (case-sensitive).
- **Correlates with** CMake package `NAME`, `cargo psibase install` package
  references, and `[package.metadata.psibase.dependencies]` keys in *other*
  packages (`NameMarket = "0.23.0"`).
- **Convention**: PascalCase matching the repo directory (`NameMarket/`).

#### Package crate (`*-pkg`)

```toml
# <App>/Cargo.toml
[package]
name = "name-market-pkg"
```

- Root library crate that aggregates service, query, and plugin workspace members.
- **Convention**: `{service-crate-name}-pkg`.
- Not deployed; only used for packaging and tests.

#### Service crate

```toml
# <App>/Cargo.toml
services = ["name-market"]

[dependencies]
name-market = { path = "service", version = "0.23.0" }
```

```toml
# <App>/service/Cargo.toml
[package]
name = "name-market"
```

**Critical:** `services = ["name-market"]` lists **Cargo dependency keys**, not
on-chain account names. `cargo-psibase` resolves each entry via `get_dep()` against
the package's `[dependencies]` table.

- **Must match** the service crate's `[package].name` and the dependency key in
  the root `Cargo.toml`.
- **Does not need to match** the on-chain `#[psibase::service(name = "…")]` value.

#### On-chain service account

```rust
// service/src/lib.rs
#[psibase::service(name = "namemarket", tables = "tables")]
```

```toml
# service/Cargo.toml — postinstall uses on-chain names
postinstall = [
    { sender = "namemarket", service = "namemarket", method = "init", data = {} },
]
```

- **Must match** across service macro, postinstall, UI `service` constants, and
  anywhere else you refer to the live account.
- **Independent of** service crate name, WIT package name, and `services = […]`.

#### Query-service crate

```toml
# service/Cargo.toml
[package.metadata.psibase]
server = "r-name-market"
```

```toml
# query-service/Cargo.toml
[package]
name = "r-name-market"
```

- **`server`** must equal the query crate's `[package].name`.
- **Convention**: `r-{service-crate-name}`.

#### On-chain query account

```rust
// query-service/src/lib.rs
#[psibase::service(name = "namemarket+1")]
```

- **Convention**: `{on-chain-service-account}+1`.
- **Must match** the base service account prefix (`namemarket` → `namemarket+1`).
- **Independent of** the `r-name-market` Cargo crate name.

#### Plugin crate

```toml
# service/Cargo.toml
plugin = "name-market-plugin"
```

```toml
# plugin/Cargo.toml
[package]
name = "name-market-plugin"
```

- **`plugin`** must equal the plugin crate's `[package].name`.
- **Convention**: `{service-crate-name}-plugin`.
- Built with `cargo component`; deployed as `/plugin.wasm` on the service subdomain.

#### WIT component package

```wit
// plugin/wit/world.wit
package name-market:plugin;
```

```toml
# plugin/Cargo.toml
[package.metadata.component]
package = "name-market:plugin"
```

- **`package` in Cargo.toml** must match the `package …;` line in WIT.
- Used in WASM import/export strings (`name-market:plugin/api#claim`) and in
  **other plugins** that import this plugin:

  ```toml
  # Consumer plugin/Cargo.toml
  "name-market:plugin" = { path = "../../NameMarket/plugin/wit/world.wit" }
  ```

- **Convention**: `{service-crate-name}:plugin` (kebab-case + `:plugin` suffix).
- **Not required** to match the on-chain account name. Hyphens are a WIT/Cargo
  readability convention, not a runtime requirement (`homepage:plugin`, `nft:plugin`
  have no hyphens).
- Other plugins import by **WIT package name**, not by on-chain account name.

#### Rust module names (from crates and WIT)

| Source | Form | Example |
|--------|------|---------|
| Service crate dependency | `-` → `_` | `use name_market::Wrapper` |
| WIT package in bindings | `-` → `_` | `name_market::plugin::api` |
| Published package in tests | `packages("NameMarket")` | PascalCase `package-name` |

#### Package dependencies (`[package.metadata.psibase.dependencies]`)

```toml
[package.metadata.psibase.dependencies]
HttpServer = "0.23.0"
Tokens = "0.23.0"
```

- Keys are **published package names** (`package-name` of other apps), not crate
  names and not on-chain accounts.
- Values are semver constraints for install order / compatibility.

### `cargo-generate` template defaults

The [package-templates](../../../../../package-templates/README.md) `basic-01` template
keeps all build-time names aligned when the chosen `project-name` fits constraints:

| Field | Template value |
|-------|----------------|
| Directory | `{{project-name \| upper_camel_case}}/` |
| `package-name` | `{{project-name \| upper_camel_case}}` |
| Package crate | `{{project-name}}-pkg` |
| Service crate | `{{project-name}}` |
| `services` | `["{{project-name}}"]` |
| On-chain service | `{{project-name}}` |
| Query crate | `r-{{project-name}}` |
| On-chain query | `{{project-name \| kebab_case}}+1` |
| Plugin crate | `{{project-name}}-plugin` |
| WIT package | `{{project-name}}:plugin` |

Template validation requires lowercase kebab-case, no digits, and length ≤ 12.
**On-chain accounts allow at most 10 characters.** When scaffolding a new app,
ensure the **on-chain** name (and `+1` query sibling) fits 10 characters; shorten
or concatenate if needed, while keeping longer kebab-case names for Cargo/WIT.

### Worked examples

#### Aligned: TokenSwap

| Layer | Value |
|-------|-------|
| Service crate | `token-swap` |
| On-chain account | `token-swap` |
| Query crate | `r-token-swap` |
| On-chain query | `token-swap+1` |
| WIT package | `token-swap:plugin` |

`token-swap` is 9 characters — hyphenated on-chain name works.

#### Split: NameMarket

| Layer | Value | Why |
|-------|-------|-----|
| Service crate | `name-market` | Cargo kebab-case |
| On-chain account | `namemarket` | `name-market` is 11 chars (> 10) |
| Query crate | `r-name-market` | Follows service crate |
| On-chain query | `namemarket+1` | Follows on-chain service |
| WIT package | `name-market:plugin` | Follows service crate, not chain account |
| `services = ["name-market"]` | Cargo key | **Not** `namemarket` |

Trust whitelists and GraphQL use `namemarket`. Cross-plugin WIT imports use
`name-market:plugin`.

### Common mistakes

| Mistake | Correct approach |
|---------|------------------|
| Setting `services = ["namemarket"]` | Use the **Cargo crate** name: `services = ["name-market"]` |
| Using WIT package name in trust whitelists | Use **on-chain account** names (`namemarket`, not `name-market`) |
| Assuming plugin WIT name must equal service account | They are different namespaces; correlate WIT with the **plugin crate** name |
| Renaming only the on-chain account | Update service macro, postinstall, GraphQL callers, whitelists, and UI constants together |
| Renaming only the WIT package | Update `world.wit`, `impl.wit`, `[package.metadata.component]`, and every consumer's WIT deps |

### Checklist for a new package

1. Pick a **repo directory** name (PascalCase, e.g. `MyApp/`).
2. Pick a **published `package-name`** (usually same PascalCase).
3. Pick a **service crate** name (kebab-case, e.g. `my-app`).
4. Verify an **on-chain account** name ≤ 10 chars; abbreviate if the kebab-case
   name is too long.
5. Set **`services = ["<service-crate>"]`** and matching `[dependencies]` key.
6. Set **`server = "r-<service-crate>"`** and create `r-<service-crate>` query crate.
7. Set **`plugin = "<service-crate>-plugin"`** and WIT `package <service-crate>:plugin`.
8. Use the **on-chain account** in `#[psibase::service]`, postinstall, GraphQL,
   and trust whitelists.
9. Use **`{on-chain-account}+1`** for the query service macro.
