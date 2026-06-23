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

A psibase app uses **many different names** to define components within the same project. Most are **build-time**
(Cargo, WIT, CMake). A smaller set are **on-chain** (account names used by actions,
GraphQL, plugins, and trust/permissions).

These layers are easy to conflate because the various names are generated from a single project name at the time of package template instantiation. The entities being named:

- Cargo and WIT prefer **kebab-case** (`name-market`, `token-swap`).
- On-chain accounts are **short strings** (max **10 characters**) and often omit
  hyphens when a hyphenated name would not fit.
- The `[package.metadata.psibase] services` field is a bit misleading, in that it lists
  **Cargo crate names**, not on-chain account names.

The quick reference table lists what each name is, where it is defined, and **what it
must correlate with** for the package to build. Any of these names can be changed, but
correlated references to the entity being renamed must match. Examples follow common
conventions or actual requirements; any valid name in the relevant namespace works.

### Quick reference

<div markdown="1">

| Identifier, Namespace, Convention vs *Requirement, Example | Location(s) (Build-time; must match) | Location(s) (Run-time) |
|------------------------------------------------------------|--------------------------------------|------------------------|
| Repo directory<br><br>Filesystem<br><br>PascalCase<br><br>`NameMarket/` | CMake: `PATH`<br><br>Cargo workspace member path in `packages/{user,system,local}/Cargo.toml` | — |
| Published package<br><br>`.psi` artifact<br><br>PascalCase; *output filename is case-sensitive<br><br>`NameMarket` | Package root `Cargo.toml`: `package-name`<br><br>CMake: `cargo_psibase_package OUTPUT` basename (or `psibase_package NAME`); `write_package_index` arg; `install FILES`; `PACKAGE_DEPENDS` refs<br><br>Dependent packages' dep lists: `[package.metadata.psibase.dependencies]` keys | Built artifact `{package-name}.psi` (`Meta.name` inside)<br><br>`packages` service: `InstalledPackage.name` (after install) |
| Package crate<br><br>Cargo<br><br>`{service-crate-name}-pkg` suffix<br><br>`name-market-pkg` | Package root `Cargo.toml`: `[package].name`<br><br>Package root `[dependencies]`: key | — |
| Service crate<br><br>Cargo<br><br>kebab-case<br><br>`name-market` | Service `Cargo.toml`: `[package].name`<br><br>Package root `[dependencies]`: key<br><br>Package root `[package.metadata.psibase]`: `services = ["…"]` | — |
| On-chain service account<br><br>Chain<br><br>*≤10 chars (and >=8 if non-premium acct); `a-z`, `0-9`, `-`; no leading/trailing/double hyphen<br><br>`namemarket` | Service `lib.rs`: `#[psibase::service(name = "…")]`<br><br>Service `Cargo.toml`: `postinstall` sender/service<br><br>UI / tests: hardcoded service strings | Service subdomain / HTTP routing<br><br>GraphQL: `service` parameter<br><br>Plugin trust: whitelist entries<br><br>Cross-service calls; event indexes |
| Query crate<br><br>Cargo<br><br>`r-{service-crate-name}` prefix<br><br>`r-name-market` | Query-service `Cargo.toml`: `[package].name`<br><br>Service `Cargo.toml`: `[package.metadata.psibase]`: `server` | — |
| On-chain query account<br><br>Chain<br><br>*`{base-account}+N` subaccount format; `+1` is usual<br><br>`namemarket+1` | Query-service `lib.rs`: `#[psibase::service(name = "…+1")]` | GraphQL / HTTP routing to query WASM<br><br>`http-server` dispatch to `{account}+1` |
| Plugin crate<br><br>Cargo<br><br>`{service-crate-name}-plugin` suffix<br><br>`name-market-plugin` | Plugin `Cargo.toml`: `[package].name`<br><br>Service `Cargo.toml`: `[package.metadata.psibase]`: `plugin` | Service subdomain: `/plugin.wasm` |
| WIT component package<br><br>WIT / WASM<br><br>`{service-crate-name}:plugin`; independent of on-chain account<br><br>`name-market:plugin` | Plugin `wit/*.wit`: `package …;`<br><br>Plugin `Cargo.toml`: `[package.metadata.component] package` | WASM module namespace (`{name}:plugin/{intf}#{fn}`) |
| Rust service module<br><br>Rust source<br><br>*kebab-case crate name → snake_case (Cargo)<br><br>`name_market` | Plugin / tests: `use {snake}::…` (from service crate name) | — |
| WIT bindings module<br><br>Generated Rust<br><br>*WIT package name → snake_case before `:plugin` (wit-bindgen)<br><br>`name_market::plugin` | Plugin `src/bindings.rs`: module path (generated) | — |
| Package dependency<br><br>Published `.psi`<br><br>PascalCase<br><br>`HttpServer` | Consumer package root `[package.metadata.psibase.dependencies]`: key<br><br>Referenced package: `package-name` | `packages` service: install dependency resolution by `Meta.name` / `InstalledPackage.name` |
| Cross-plugin WIT dep key<br><br>WIT imports<br><br>*must match provider WIT package name<br><br>`name-market:plugin` | Consumer plugin `Cargo.toml`: `[package.metadata.component.target.dependencies]` key<br><br>Consumer plugin `wit/impl.wit`: `import …` | WASM linker: import module string |

</div>

On-chain service and query account names must follow the [account number
rules](../../../specifications/data-formats/account-numbers.md).

### Common mistakes

| Mistake | Correct approach |
|---------|------------------|
| Setting `services = ["namemarket"]` | Use the **Cargo crate** name: `services = ["name-market"]` |
| Using WIT package name in trust whitelists | Use **on-chain account** names (`namemarket`, not `name-market`) |
| Assuming plugin WIT name must equal service account | They are different namespaces; correlate WIT with the **plugin crate** name |
| Renaming only the on-chain account | Update service macro, postinstall, GraphQL callers, whitelists, and UI constants together |
| Renaming only the WIT package | Update `world.wit`, `impl.wit`, `[package.metadata.component]`, and every consumer's WIT deps |

### For manually-built packages

1. Pick a **repo directory** name (PascalCase, e.g. `MyApp/`).
2. Pick a **published `package-name`** (usually same PascalCase).
3. Pick a **service crate** name (kebab-case, e.g. `my-app`).
4. Pick an **on-chain account** name that satisfies the [account number
   rules](../../../specifications/data-formats/account-numbers.md); abbreviate if
   the kebab-case crate name is too long.
5. Set **`services = ["<service-crate>"]`** and matching `[dependencies]` key.
6. Set **`server = "r-<service-crate>"`** and create `r-<service-crate>` query crate.
7. Set **`plugin = "<service-crate>-plugin"`** and WIT `package <service-crate>:plugin`.
8. Use the **on-chain account** in `#[psibase::service]`, postinstall, GraphQL,
   and trust whitelists.
9. Use **`{on-chain-account}+1`** for the query service macro.
