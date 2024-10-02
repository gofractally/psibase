# Rust Dev Chicken Scratch

This is a place to capture

1. dev challenges we come across while working that either need better docs or better dev tools
2. bugs that need addresses
3. dev weak points that require a dev to know to much about the system, i.e., there's no reason the dev experience should be so esoteric

Note: some doc updates are done here simply because we're more intersted in capturing the issues (rather than forgetting them) than we are in writing perfect docs. Once they're captured, we can always go back and 1) write good docs and 2) fix dev issues we have recorded. If we don't capture them as they happen, they disappear to time, and the dev experience sucks (as we acclimate to hardships we've gotten used to and forget new devs will be in the dark about.)

## Potential Tasks

1. add tests for psibase_macros
2. fix hygiene of psibase_macros.service_impl (details below in Bugs section)

## Doc Updates

### Tables

#### Singleton Tables

[Current doc on Singletons](development/services/rust-service/tables.html#singletons) uses in-place code, rather than a generalized, explicit Singleton construct. Probably worth defining a `Singleton` thing that makes it explicit what's happening. Could be a type def, a struct, or some kind of Trait or Key type.

The code snippets I think could be improved are as follows:

```
// A somewhat esoteric way to define the key
impl LastUsed {
    // The primary key is an empty tuple. Rust functions
    // which return nothing actually return ().
    #[primary_key]
    fn pk(&self) {}
}
```

```
// Requesting the only table record: the esoteric key = `&()`
let mut lastUsed =
            table.get_index_pk().get(&()).unwrap_or_default();
```

#### Externalizing Table definitions and their structs / Code Splitting

The basic Table docs for "[Storing Structs Defined Elsewhere](development/services/rust-service/tables.html#storing-structs-defined-elsewhere)" are outdated.

1. `Reflect` doesn't seem to exist.
2. using the documented `impl WrapMessage { ... }` doesn't seem to work anymore. Updated doc that I believe accomplishes the same thing is below.

The `service` mod, being decorated by the `service` attribute macro, has a lot of magic go on when it processes the mod. It can be very non-obvious how to split out tables and lead to a dev putting all their code in the module. Obviously, we need a way to separate tables out from the module for better code splitting, readability, and encapsulation.

First you can move the table's struct (record definition) out of the module by structuring it as follows:

```
use psibase::{Fracpack, TableRecord};
use serde::{Deserialize, Serialize};

impl TableRecord for MyTableRec {
    type PrimaryKey = u64;

    const SECONDARY_KEYS: u8 = 0;

    fn get_primary_key(&self) -> Self::PrimaryKey {
        self.event_id
    }
}

#[derive(Debug, Fracpack, Serialize, Deserialize)]
pub struct MyTableRec {
    pub field1: u64,
    pub field2: String,
}
```

Then define only the table itself in the `service` mod:

```
    use psibase::{Fracpack, Table};
    use serde::{Deserialize, Serialize};
    ...
    #[table(name = "MyTable", record = "MyTableRec")]
    #[derive(Debug, Fracpack, Serialize, Deserialize)]
    struct MyTable;
    ...
```

## Dev Challenges

## Bugs

`service` macro's hygiene could use some cleanup.

1. `anyhow` must be imported for the macro to be happy (need to clarify under what circumstances this is the case to fix it properly)
2. `Table` must be imported for the macro to be happy (need to figure out which table def exactly require it. Maybe just be when record = "" is specified in the `table` macro).
   `Table` is a Trait that implements things like <table name>::new(). Getting a reference to a table won't work without bringing the Trait into scope. We could bring it in scope whenever the named table shows up in an #[action]. We could also have the macro look for any element of the Trait and include `Table` only if it finds it being used. Perhaps there's a way to define tables that naturally pulls it into scope?
3. `asyncgraphql_*` need to be `use`d in some cases. should come along with Query definitions.

```svgbob
+-------------+      +---------+      +---------+
| http-server |      |         |      | HTTP    |
| service     |<---- | psinode |<---- | Request |
|             |      |         |      |         |
+-------------+      +---------+      +---------+
         |
         |
         v
  +--------------+           +-----------------+
 /                \  yes     | common-api      |
/  target begins   \ ------> | service's       |
\  with "/common?" /         | serveSys action |
 \                /          +-----------------+
  +--------------+                    ^
         | no                         |
         |                +-----------+
         v                |
  +----------------+      |  +-----------------+
 /                  \  no |  | sites           |
/  on a subdomain?   \ ---+  | service's       |
\                    /       | serveSys action |
 \                  /        +-----------------+
  +----------------+                  ^
         | yes                        |
         |           +----------------+
         v           |
  +------------+  no |       +-----------------+
 /              \ ---+       | registered      |
/  registered?   \           | service's       |
\                / yes   +-->| serveSys action |
 \              / -------+   +-----------------+
  +------------+
```

`psinode` passes most HTTP requests to the [SystemService::HttpServer] service, which then routes requests to the appropriate service's [serveSys](https://docs.rs/psibase/latest/psibase/server_interface/struct.ServerActions.html#method.serveSys) action (see diagram). The services run in RPC mode; this prevents them from writing to the database, but allows them to read data they normally can't. See [psibase::DbId](https://docs.rs/psibase/latest/psibase/enum.DbId.html).

[SystemService::CommonApi] provides services common to all domains under the `/common` tree. It also serves the chain's main page.

[SystemService::Sites] provides web hosting for non-service accounts or service accounts that did not [register](#registration) for HTTP handling.

`psinode` directly handles requests which start with `/native`, e.g. `/native/push_transaction`. Services don't serve these.

## Registration

Services which wish to serve HTTP requests need to register using the [SystemService::HttpServer] service's [SystemService::HttpServer::registerServer] action. This is usually done by setting the `package.metadata.psibase.server` field in `Cargo.toml` to add this action to the package installation process.

A service doesn't have to serve HTTP requests itself; it may delegate this to another service during registration.

## HTTP Interfaces

Services which serve HTTP implement these interfaces:

- [psibase::server_interface](https://docs.rs/psibase/latest/psibase/server_interface/index.html) (required)
  - [psibase::HttpRequest](https://docs.rs/psibase/latest/psibase/struct.HttpRequest.html)
  - [psibase::HttpReply](https://docs.rs/psibase/latest/psibase/struct.HttpReply.html)
- [psibase::storage_interface](https://docs.rs/psibase/latest/psibase/storage_interface/index.html) (optional)

## Helpers

These help implement basic functionality:

- [psibase::serve_simple_ui](https://docs.rs/psibase/latest/psibase/fn.serve_simple_ui.html)
- [psibase::serve_simple_index](https://docs.rs/psibase/latest/psibase/fn.serve_simple_index.html)
- [psibase::serve_action_templates](https://docs.rs/psibase/latest/psibase/fn.serve_action_templates.html)
- [psibase::serve_schema](https://docs.rs/psibase/latest/psibase/fn.serve_schema.html)
- [psibase::serve_pack_action](https://docs.rs/psibase/latest/psibase/fn.serve_pack_action.html)

Here's a common pattern for using these functions.
[`#[psibase::service]`](https://docs.rs/psibase/latest/psibase/attr.service.html) defines `Wrapper`;
the `serve_*` functions fetch action definitions from Wrapper.

```rust
#[psibase::service]
#[allow(non_snake_case)]
mod service {
    use psibase::*;

    #[action]
    fn serveSys(request: HttpRequest) -> Option<HttpReply> {
        if request.method == "GET"
        && (request.target == "/" || request.target == "/index.html")
        {
            return Some(HttpReply {
                contentType: "text/html".into(),
                body: "<b>This is my UI</b>".into(),
                headers: vec![],
            });
        }

        None.or_else(|| serve_schema::<Wrapper>(&request))
            .or_else(|| serve_action_templates::<Wrapper>(&request))
            .or_else(|| serve_pack_action::<Wrapper>(&request))
    }
}
```
