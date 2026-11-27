# Building an app

This guide describes the one pattern a psibase app follows, from chain state to the screen. It is written from the packages that follow it most closely: `packages/user/Fractals` (all Rust), `packages/user/Tokens` (Rust service with a C++ header), and `packages/user/Invite` (C++ service with a Rust plugin). Read those beside this guide.

> **Status: draft for review** ([#2286](https://github.com/gofractally/psibase/issues/2286)). Where practice in the tree is split, this guide picks one side; the choices are listed in [Choices this guide makes](#choices-this-guide-makes) and await confirmation.

- [The four parts](#the-four-parts)
- [Rules that hold everywhere](#rules-that-hold-everywhere)
- [Layout of a package](#layout-of-a-package)
- [1. The service](#1-the-service)
- [2. The query service](#2-the-query-service)
- [3. The plugin](#3-the-plugin)
- [4. The UI](#4-the-ui)
- [Using another app's data](#using-another-apps-data)
- [Build, test, deploy](#build-test-deploy)
- [Checklist](#checklist)
- [Choices this guide makes](#choices-this-guide-makes)

How a call travels between the parts, with diagrams, is in [Call flows](call-flows.md). Read it once before writing a plugin.

## The four parts

| Part | Runs | Written in | Job |
|---|---|---|---|
| **Service** | On chain, in every node, inside a transaction | Rust or C++ | Owns the tables. Its actions are the only way state changes. Objective: every node gets the same result. |
| **Query service** | On the node that receives an HTTP request | Rust or C++ | Reads the service's tables and answers queries. Changes nothing. |
| **Plugin** | In the user's browser, inside the supervisor | Rust, compiled to a wasm component | The app's logic on the client: builds transactions, runs queries, decides what other apps may learn. Holds no state between calls. |
| **UI** | In the user's browser, on the app's own address | TypeScript, React | The view. Calls its own plugin and renders the result. |

A write goes UI → plugin → supervisor → node → service → tables. A read goes UI → plugin → supervisor → node → query service → tables, and back.

## Rules that hold everywhere

1. **State changes only through actions.** A query service never writes. A UI never builds a transaction.
2. **A UI calls only its own plugin.** It does not call another app's plugin, and it does not fetch another service's address. If it needs something from another app, its plugin asks that app's plugin.
3. **The plugin holds the logic; the UI holds the view.** Validation, unit conversion, choosing which actions make up an operation: plugin. Layout, forms, navigation: UI.
4. **Plugins are stateless.** Every call gets fresh plugin instances, which are discarded when it returns. Anything that must outlive a call goes in plugin storage.
5. **One call, one transaction.** Every action a plugin call schedules, in this plugin and in any it calls, goes into a single transaction that is signed and sent when the call returns. Calls do not overlap.
6. **A service's interface is published once.** The service definition is the source. Code in the other language uses a mirror that a test checks against the published schema.
7. **The query service authenticates; the plugin discloses.** A private query checks only that the request's user is the user asked about. Which apps may learn what is decided by the owning app's plugin, in the user's browser.
8. **Every exported plugin function declares a trust level.**

## Layout of a package

```
packages/user/MyApp/
├── Cargo.toml            root crate "myapp-pkg": names the package and its services
├── src/lib.rs            (empty; the crate exists to tie the others together)
├── service/              crate "myapp"            → account  myapp
├── query-service/        crate "r-myapp"          → account  myapp+1
├── plugin/               crate "myapp-plugin"     → plugin.wasm, served by myapp
│   └── wit/              world.wit (interfaces), impl.wit (imports and exports)
└── ui/                   React app, built into ui/dist, served by myapp
```

Root `Cargo.toml`:

```toml
[package]
name = "myapp-pkg"

[package.metadata.psibase]
package-name = "MyApp"
services = ["myapp"]

[package.metadata.psibase.dependencies]   # other packages, by package name
Accounts = "0.29.0"
HttpServer = "0.29.0"
Sites = "0.29.0"
Transact = "0.29.0"

[lib]
crate-type = ["rlib"]

[dependencies]
myapp = { path = "service", version = "0.29.0" }
r-myapp = { path = "query-service", version = "0.29.0" }
myapp-plugin = { path = "plugin", version = "0.29.0" }
```

`service/Cargo.toml` says what the service's account serves:

```toml
[package.metadata.psibase]
server = "r-myapp"                              # the crate that answers HTTP for it
plugins = ["myapp-plugin"]
data = [{ src = "../ui/dist", dst = "/" }]      # the built UI
postinstall = [
    { sender = "myapp", service = "sites", method = "enablespa", data = { enable = true } },
]
```

The keys are documented in [Building packages](../services/rust-service/package.md). Register the crates in `packages/user/Cargo.toml`, the UI in `packages/package.json`, and the package in the root `CMakeLists.txt` with `cargo_psibase_package`.

## 1. The service

```rust
#[psibase::service(tables = "tables::tables")]
pub mod service {
    use crate::tables::tables::Thing;
    use psibase::*;

    #[action]
    fn create(name: String) {
        let owner = get_sender();
        check(!name.is_empty(), "name is required");
        Thing::add(owner, name);
        Wrapper::emit().history().created(owner);
    }

    #[event(history)]
    pub fn created(owner: AccountNumber) {}
}
```

Tables live in their own module, one file per table for its methods:

```rust
#[psibase::service_tables]
pub mod tables {
    use async_graphql::SimpleObject;
    use psibase::*;

    #[table(name = "ThingTable", index = 0)]
    #[derive(Default, SimpleObject, Debug,
             psio::PsszPack, psio::PsszUnpack, psio::PsszView,
             psio::ToPsszSchema, psio::JsonText, psio::Serde)]
    pub struct Thing {
        #[primary_key]
        pub owner: AccountNumber,
        pub name: String,
    }
}
```

- **Derives.** Use the `psio::` set above. The older `Pack`, `Unpack` and `ToSchema` derives no longer exist; pages of this book that still show them are out of date.
- **Authorization.** `get_sender()` is the account the action runs as. Check it; nothing else says who is acting.
- **Never change a table index number or reorder keys** once the service is deployed.
- **Events** are declared with `#[event(history)]` and emitted with `Wrapper::emit().history()`.
- **Calling another service:** `other::Wrapper::call().action(args)`.

### How others see the interface

The macro generates a `Wrapper`, the `action_structs` and a schema from the service module. Three artifacts follow from it:

| For | Artifact | Kept in step by |
|---|---|---|
| Any Rust crate | The service crate itself (`myapp::Wrapper`) | Being the definition |
| System code that cannot depend on the crate | A hand-written mirror in `rust/psibase/src/services/` | Its `verify_schema` test |
| C++ | A hand-written header in `include/services/user/` | `CHECK_SCHEMA(MyApp)` in a C++ test |
| Tools, the CLI, other languages | The schema inside the package, served at `packages.<root>/schema?service=myapp` | Generated at build |

For a C++ service the header with `PSIO_REFLECT` is the definition, and the Rust mirror carries the `verify_schema` test.

**A mirror without its schema test is a bug waiting to happen.** Add the test in the same change as the mirror.

## 2. The query service

A separate crate, on the account `<service>+1`, that depends on the service crate for its tables:

```rust
#[psibase::service(name = "myapp+1")]
#[allow(non_snake_case)]
mod service {
    use async_graphql::{connection::Connection, *};
    use myapp::tables::tables::{Thing, ThingTable};
    use psibase::*;

    struct Query {
        user: Option<AccountNumber>,
    }

    #[Object]
    impl Query {
        /// Public: anyone may read it.
        async fn thing(&self, owner: AccountNumber) -> Option<Thing> {
            ThingTable::with_service(myapp::SERVICE).get_index_pk().get(&owner)
        }

        /// A list is always a connection, never an unbounded array.
        async fn things(
            &self,
            first: Option<i32>, last: Option<i32>,
            before: Option<String>, after: Option<String>,
        ) -> async_graphql::Result<Connection<RawKey, Thing>> {
            TableQuery::new(ThingTable::with_service(myapp::SERVICE).get_index_pk())
                .first(first).last(last).before(before).after(after)
                .query().await
        }
    }

    #[action]
    fn serveSys(
        request: HttpRequest,
        socket: Option<i32>,
        user: Option<AccountNumber>,
    ) -> Option<HttpReply> {
        None.or_else(|| serve_graphql(&request, Query { user }))
            .or_else(|| serve_graphiql(&request))
    }
}
```

- **GraphQL, not REST.** One `Query` object; `serve_graphiql` gives a browsable schema at `/graphiql`.
- **Lists are connections** with `first`, `last`, `before`, `after`. Use `TableQuery::subindex` to list by a key prefix.
- **Private data:** `user` is the account the request's session token names, or nothing. A query that returns one user's private data refuses unless `self.user == Some(asked_about)`. See `Tokens/query-service/src/lib.rs` (`check_user_auth`), which also only honours `user` on its own host.
- **A query costs the node that serves it.** Keep each one bounded: an index lookup or a page, never a scan.

## 3. The plugin

`plugin/wit/world.wit` declares the interfaces; `plugin/wit/impl.wit` says what this component imports and exports:

```wit
package myapp:plugin;

interface api {
    use host:types/types.{error};

    /// Creates a thing owned by the current user.
    create: func(name: string) -> result<_, error>;
}

/// Authorized queries to this app's own query service.
interface authorized {
    use host:types/types.{error};
    graphql: func(query: string) -> result<string, error>;
}

world imports {
    import api;
    import authorized;
}
```

```wit
package myapp:plugin;

world impl {
    include transact:plugin/imports;

    export api;
    export authorized;
}
```

```rust
#[allow(warnings)]
mod bindings;
mod errors;

use bindings::exports::myapp::plugin::api::Guest as Api;
use bindings::exports::myapp::plugin::authorized::Guest as Authorized;
use myapp::Wrapper as MyApp;
use psibase_plugin::{trust::*, *};

struct MyAppPlugin;

impl TrustConfig for MyAppPlugin {
    fn capabilities() -> Capabilities {
        Capabilities {
            low: &[],
            medium: &["Creating a thing in your name"],
            high: &[],
        }
    }
}

impl Api for MyAppPlugin {
    #[psibase_plugin::authorized(Medium)]
    fn create(name: String) -> Result<(), Error> {
        if name.trim().is_empty() {
            return Err(errors::ErrorType::NameRequired.into());
        }
        MyApp::add_to_tx().create(name);
        Ok(())
    }
}

impl Authorized for MyAppPlugin {
    #[psibase_plugin::authorized(None)]
    fn graphql(query: String) -> Result<String, Error> {
        host::server::post_graphql_get_json(&query)
    }
}

bindings::export!(MyAppPlugin with_types_in bindings);
```

**Writing.** `Wrapper::add_to_tx().action(args)` packs the arguments and adds the action to the call's transaction. It does not send anything; the transaction goes when the call returns. The sender is the logged-in user.

**Reading.** `host::server::post_graphql_get_json(query)` posts to the plugin's **own** service with the user's session attached, and returns the JSON text. Parse it into local `serde` structs (`#[serde(rename_all = "camelCase")]`); see `Fractals/plugin/src/graphql.rs`. A plugin cannot reach any other address.

**Trust levels.** Every exported function carries `#[psibase_plugin::authorized(Level)]`:

| Level | Use for | When another app's plugin calls it |
|---|---|---|
| `None` | Reads of public data, pure helpers | Always allowed |
| `Low` | Harmless actions | The user is asked once, and the answer is remembered for that app |
| `Medium` | Actions in the user's name with limited consequence | Same, shown to the user as a medium-trust request |
| `High` | Moving value, changing settings | Same, shown as a high-trust request |
| `Max` | Things only this app itself should ever do | Refused unless the caller is on the whitelist |

A plugin calling itself always passes, as does the app the user is on when it calls its own plugin. `whitelist = ["homepage", ...]` lets named apps through without a prompt. The strings in `capabilities()` are what the user reads when asked, so write them as things a person would recognise.

**Types across the boundary.** Parameters are scalars. Account names and decimal amounts are `string`. Structured results are WIT `record`s. Do not pass JSON text as an argument or a result, with the one exception of `authorized.graphql`.

**Errors.** One enum per plugin:

```rust
#[derive(Debug, psibase_plugin::ErrorEnum, thiserror::Error)]
#[repr(u32)]
pub enum ErrorType {
    #[error("A name is required")]
    NameRequired,
}
```

**Storage.** For anything that must outlive a call, use the `clientdata:plugin/keyvalue` interface (or `host:db` buckets). It is namespaced to the plugin and encrypted on the device. It is per browser: do not put anything there that the user cannot afford to lose.

**What a plugin cannot do.** Wait for the user, hold a connection open, run in the background, or call the browser's own APIs. A plugin that needs a decision from the user calls `host:prompt`; the call is abandoned, the user is shown the prompt, and the UI repeats the action afterwards.

**Tests.** Keep logic that does not touch the host in plain functions and test them natively with `#[cfg(test)]` (see `Tokens/plugin/src/transfer_policy.rs`).

`plugin/Cargo.toml` needs `crate-type = ["cdylib"]`, `[package.metadata.component] package = "myapp:plugin"`, `target.world = "impl"`, the mapping `"host:types/types" = "psibase_plugin::types"`, and a `target.dependencies` entry for each plugin it imports. Copy `Fractals/plugin/Cargo.toml`. The generated `src/bindings.rs` is committed.

## 4. The UI

The stack is fixed, so that every app looks and behaves alike: React, Vite through `packages/vite.shared.ts`, the shared library `packages/shared-ui` (imported as `@shared/...`: shadcn components, the theme provider, the query client, sonner toasts), TanStack Query for data, zod for validating what comes back, and the sidebar shell (`components/layout.tsx`, `app-sidebar.tsx`, `nav-main.tsx`). Dark theme is the default. Copy `Fractals/ui` for the configuration files.

**Describe your plugin once**, in `packages/shared-ui/lib/plugins/`, so calls are typed:

```ts
class Api extends PluginInterface {
    protected override readonly _intf = "api" as const;

    get create() {
        return this._call<[name: string], void>("create");
    }
}
```

**Read** through your plugin's `authorized.graphql`, validate with zod, and cache with a key from `lib/query-keys.ts`:

```ts
export const getThings = async () => {
    const res = await graphqlAuth(
        myapp.authorized.graphql,
        `{ things(first: 50) { nodes { owner name } } }`,
    );
    return z
        .object({ things: z.object({ nodes: zThing.array() }) })
        .parse(res).things.nodes;
};

export const useThings = () =>
    useQuery({ queryKey: QueryKey.things(), queryFn: getThings });
```

**Write** with the plugin-function hook, which shows the loading, success and error toasts:

```ts
const { mutate: create } = usePluginFunctionMutation(myapp.api.create, {
    toast: { loading: "Creating", success: "Created", error: "Could not create" },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QueryKey.things() }),
});
```

- **A write resolves when the transaction is final.** Then invalidate the queries it affects. There is no notification from the node; see [Known limits](call-flows.md#known-limits).
- **Do not `fetch` another service.** The site's content-security policy allows only the app's own address (plus `profiles` and `tokens` for images and public metadata), and such a request would carry no user anyway.
- **No secrets in the UI.** Keys and session tokens live in the supervisor. The page never sees them.

## Using another app's data

Suppose your app needs the user's token balances.

1. Add the other plugin to `impl.wit` (`include tokens:plugin/imports;`) and to `target.dependencies` in the plugin's `Cargo.toml`.
2. Call it from **your plugin**: `tokens::plugin::helpers::get_user_balances(&user)`.
3. Return what your UI needs from your own plugin function, as a typed record.

The Tokens plugin decides whether your app may have the answer. Its function is `authorized(High, whitelist = [...])`, so the first time, the user is asked whether your app may do this; the call is abandoned and the user repeats the action after approving. Design the screen so that repeating is natural.

When you write the function another app will call, you are deciding what that app learns. Return the least that serves the purpose: one balance, not the list; yes or no, not the amount. That decision lives in your plugin, not in your service, and no chain state records it.

## Build, test, deploy

```sh
cargo psibase package            # build service, query service, plugin; bundle with ui/dist into a .psi
cargo psibase test               # run the service's tests on a simulated chain
cargo psibase install            # build and install on a running local node
psibase install MyApp            # install a built package from a package source
psibase publish ...              # publish to a registry (see the psibase CLI reference)
```

Inside the repository the package is built by CMake through `cargo_psibase_package`, after the UI (`yarn build` in `ui/`).

**Service tests** run against a chain that has the package installed:

```rust
#[psibase::test_case(packages("MyApp"))]
fn creates_a_thing(chain: psibase::Chain) -> Result<(), psibase::Error> {
    let alice = account!("alice");
    chain.new_account(alice)?;
    Wrapper::push_from(&chain, alice).create("first".to_string()).get()?;
    Ok(())
}
```

**After install, a package's `postinstall` actions run.** Use them to enable single-page routing (`sites.enablespa`), and to set a content-security policy only if the default does not fit (`sites.setcsp`; see [sites](../../default-apps/sites.md)).

**A development chain is not a public chain.** A chain booted the quick way (`psibase boot` with no `--block-key`) accepts unsigned transactions from `root`, which is what lets `cargo psibase install` and `psibase install` work with no keys. Never expose such a node to a network; see the warning under [`boot`](../../run-infrastructure/cli/psibase.md#boot).

**Upgrades.** Installing a newer version replaces code, plugin and UI. Tables stay. A change to a table's layout needs a migration action; plan it before the first deployment.

## Checklist

Service
- [ ] Every action checks `get_sender()` where it matters.
- [ ] Tables use the `psio::` derives; index numbers and key order are final.
- [ ] Events declared and emitted for anything a history view will need.
- [ ] Any mirror (Rust or C++) has its schema test.

Query service
- [ ] Separate crate `r-<app>`, account `<app>+1`, GraphQL with graphiql.
- [ ] Every list is a connection; every query is bounded.
- [ ] Private queries compare `user` with the account asked about.

Plugin
- [ ] `psibase_plugin`: `TrustConfig`, `#[authorized]` on every export, `add_to_tx()`.
- [ ] Typed WIT; no JSON strings except `authorized.graphql`.
- [ ] No state kept in memory between calls.
- [ ] Functions other apps may call return the least they need.
- [ ] Native unit tests for the logic.

UI
- [ ] In the `packages/package.json` workspace, built with `vite.shared.ts`, using `@shared`.
- [ ] Calls only its own plugin, through typed descriptors.
- [ ] Reads: `graphqlAuth` + zod + query keys. Writes: `usePluginFunctionMutation`, then invalidate.
- [ ] No direct fetches to other services; no keys or tokens.

Package
- [ ] Registered in the Cargo workspace, the yarn workspace and CMake.
- [ ] `cargo psibase test` passes; the UI builds with no lint errors.

## Choices this guide makes

Practice in the tree is not uniform. This guide teaches one side of each of these; the other side exists in older packages and should not be copied.

| Topic | This guide | Also found in the tree |
|---|---|---|
| Plugin style | `psibase_plugin`: `TrustConfig`, `#[authorized]`, `add_to_tx()` (Fractals, Guilds, Tokens, Invite) | `define_trust!` with `add_action_to_transaction` (most older plugins, and the package template) |
| UI to plugin | Typed descriptors and `usePluginFunctionMutation` | `supervisor.functionCall` with names as strings |
| UI reads | Through the app's own plugin | Direct `fetch` to a service's `/graphql` |
| Where HTTP is served | A `<service>+1` GraphQL query service | The service's own account (Branding, Identity, Chainmail, VirtualServer); REST endpoints |
| Plugin function types | Typed WIT records and scalars | JSON text in and out (`execute(method, args-json)` in Exchange and the bridges) |
| UI toolchain | The shared workspace | Stand-alone builds outside it (Exchange, Favor, the bridges, the Tokens prompt page) |

Not yet documented anywhere, and so not covered here: the local development loop for a UI against a running node, and linking plugins at run time (`dyn-ld`).
