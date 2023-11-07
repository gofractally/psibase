# Tables (Rust)

Services store data in psibase's key-value store, normally using tables.

## A Simple Table

Let's build a service which allows users to send public messages to each other. We'll store the messages in a table.

```
cargo new --lib messages
cd messages
cargo add psibase serde_json regex
cargo add -F derive serde
```

```rust
#[allow(non_snake_case)] // javascript-friendly names
#[psibase::service]
mod service {
    use psibase::*;
    use serde::{Deserialize, Serialize};

    // Our first table (index 0) is MessageTable. It stores Message.
    #[table(name = "MessageTable", index = 0)]
    #[derive(Fracpack, Reflect, Serialize, Deserialize)]
    pub struct Message {
        // Every table has a unique primary key. This doesn't have
        // to be a u64; many types may be keys, including String,
        // Vec, tuples, and structs. It also doesn't have to be a
        // field; the #[primary_key] attribute can work on methods.
        // Primary key methods often return tuples containing field
        // values.
        #[primary_key]
        id: u64,

        from: AccountNumber,
        to: AccountNumber,
        content: String,
    }

    // Store a message
    #[action]
    fn storeMessage(id: u64, to: AccountNumber, content: String) {
        // Open the table. #[table(...)] defined MessageTable.
        let message_table = MessageTable::new();

        // This will overwrite any messages with the same ID,
        // including messages from other users. It also allows users
        // to insert messages out of order. We'll fix both issues
        // below.
        message_table
            .put(&Message {
                id,
                from: get_sender(),
                to,
                content,
            })
            .unwrap();
    }

    // Get all messages which have ids >= begin and < end
    #[action]
    fn getMessages(begin: u64, end: u64) -> Vec<Message> {
        let message_table = MessageTable::new();

        // The primary index iterates and searches by primary key
        let index = message_table.get_index_pk();

        index.range(begin..end).collect()
    }

    // The UI allows us to test things manually
    #[action]
    fn serveSys(request: HttpRequest) -> Option<HttpReply> {
        serve_simple_ui::<Wrapper>(&request)
    }
}
```

## Trying It Out

```
# Build and deploy the service
cargo psibase deploy -ip

# Create some test users
psibase create -i alice
psibase create -i bob
psibase create -i sue
```

If you're running psibase locally, you can follow the [minimal UI instructions](./minimal-ui.md#trying-the-ui) to connect to the `messages` service.

- Use `storeMessage` to create messages
- Use `getMessages`

`getMessages` makes it possible for other services to retrieve messages without accessing this service's tables directly. However, there isn't currently a way for javascript to get decoded return values (TODO), so the developer UI shows hex in the transaction trace. It's also wasteful in most cases to push transactions just to run a query. We can add a custom RPC endpoint to address these issues.

## Custom RPC

Replace `serveSys` with the following. This handles RPC requests of the form `/messages/begin/end`, where `begin` and `end` are integer keys. This returns the selected messages in a JSON array.

```rust
#[action]
fn serveSys(request: HttpRequest) -> Option<HttpReply> {
    let re = regex::Regex::new(
        "^/messages/([0-9]+)/([0-9]+)$").unwrap();
    if let Some(captures) = re.captures(&request.target) {
        return Some(HttpReply {
            contentType: "application/json".into(),
            body: serde_json::to_vec(&getMessages(
                captures[1].parse().unwrap(),
                captures[2].parse().unwrap(),
            ))
            .unwrap()
            .into(),
            headers: vec![],
        });
    }

    serve_simple_ui::<Wrapper>(&request)
}
```

Redeploy the service and test it out:

```
cargo psibase deploy -ip

curl http://messages.psibase.127.0.0.1.sslip.io:8080/messages/0/99999999 | jq
curl http://messages.psibase.127.0.0.1.sslip.io:8080/messages/20/30 | jq
```

`jq`, if you have it installed, pretty-prints the result.

## Singletons

A singleton is a table that has at most 1 row. Let's add one to track the most-recent message ID so we can keep messages in order.

```rust
#[allow(non_snake_case)]
#[psibase::service]
mod service {
    use psibase::*;
    use serde::{Deserialize, Serialize};

    // We can't renumber tables without corrupting
    // them. This table remains 0.
    #[table(name = "MessageTable", index = 0)]
    #[derive(Fracpack, Reflect, Serialize, Deserialize)]
    pub struct Message {
        #[primary_key]
        id: u64,

        from: AccountNumber,
        to: AccountNumber,
        content: String,
    }

    // This table stores the last used message ID
    #[table(name = "LastUsedTable", index = 1)]
    #[derive(Default, Fracpack, Reflect, Serialize, Deserialize)]
    pub struct LastUsed {
        lastMessageId: u64,
    }

    impl LastUsed {
        // The primary key is an empty tuple. Rust functions
        // which return nothing actually return ().
        #[primary_key]
        fn pk(&self) {}
    }

    // This is not an action; others can't call it.
    fn get_next_message_id() -> u64 {
        let table = LastUsedTable::new();

        // Get record, or default if doesn't yet exist
        let mut lastUsed =
            table.get_index_pk().get(&()).unwrap_or_default();

        // Update lastMessageId
        lastUsed.lastMessageId += 1;
        table.put(&lastUsed).unwrap();
        lastUsed.lastMessageId
    }

    // The caller no longer provides an ID; we return it instead.
    #[action]
    fn storeMessage(to: AccountNumber, content: String) -> u64 {
        let message_table = MessageTable::new();
        let id = get_next_message_id();
        message_table
            .put(&Message {
                id,
                from: get_sender(),
                to,
                content,
            })
            .unwrap();
        id
    }

    // Same as before
    #[action]
    fn getMessages(begin: u64, end: u64) -> Vec<Message> {
        let message_table = MessageTable::new();
        let index = message_table.get_index_pk();
        index.range(begin..end).collect()
    }

    // Same as before
    #[action]
    fn serveSys(request: HttpRequest) -> Option<HttpReply> {
        let re = regex::Regex::new(
            "^/messages/([0-9]+)/([0-9]+)$").unwrap();
        if let Some(captures) = re.captures(&request.target) {
            return Some(HttpReply {
                contentType: "application/json".into(),
                body: serde_json::to_vec(&getMessages(
                    captures[1].parse().unwrap(),
                    captures[2].parse().unwrap(),
                ))
                .unwrap()
                .into(),
                headers: vec![],
            });
        }

        serve_simple_ui::<Wrapper>(&request)
    }
}
```

You should be able to try this as before. This time however, `storeMessage` returns an ID; users can't post messages out of order or overwrite other users' messages, except for a new bug.

We modified the behavior of an already-deployed service and introduced a bug in the process. The new version gradually overwrites messages created by the previous version. Production services need to be very careful with upgrades.

## Secondary Indexes

So far we have a way to page through all messages, but don't have a good way to page through all messages from a particular user, or to a particular user. We can add secondary indexes to solve this.

```rust
#[allow(non_snake_case)]
#[psibase::service]
mod service {
    use psibase::*;
    use serde::{Deserialize, Serialize};

    // Same as before
    #[table(name = "MessageTable", index = 0)]
    #[derive(Fracpack, Reflect, Serialize, Deserialize)]
    pub struct Message {
        #[primary_key]
        id: u64,

        from: AccountNumber,
        to: AccountNumber,
        content: String,
    }

    impl Message {
        // Secondary keys must be functions; unlike primary_key, the
        // secondary_key attribute does not work on data members.
        //
        // The first secondary key is 1 (the primary key is 0).
        #[secondary_key(1)]
        fn by_from(&self) -> (AccountNumber, u64) {
            // Secondary keys must be unique. If we only returned
            // self.from, then a user would only be able to store a
            // single message.
            (self.from, self.id)
        }

        #[secondary_key(2)]
        fn by_to(&self) -> (AccountNumber, u64) {
            (self.to, self.id)
        }
    }

    // Same as before
    #[table(name = "LastUsedTable", index = 1)]
    #[derive(Default, Fracpack, Reflect, Serialize, Deserialize)]
    pub struct LastUsed {
        lastMessageId: u64,
    }

    // Same as before
    impl LastUsed {
        #[primary_key]
        fn pk(&self) {}
    }

    // Same as before
    fn get_next_message_id() -> u64 {
        let table = LastUsedTable::new();
        let mut lastUsed =
            table.get_index_pk().get(&()).unwrap_or_default();
        lastUsed.lastMessageId += 1;
        table.put(&lastUsed).unwrap();
        lastUsed.lastMessageId
    }

    // Same as before
    #[action]
    fn storeMessage(to: AccountNumber, content: String) -> u64 {
        let message_table = MessageTable::new();
        let id = get_next_message_id();
        message_table
            .put(&Message {
                id,
                from: get_sender(),
                to,
                content,
            })
            .unwrap();
        id
    }

    #[action]
    fn serveSys(request: HttpRequest) -> Option<HttpReply> {
        let message_table = MessageTable::new();

        let re = regex::Regex::new(
            "^/messages/([a-z]+)/([a-z]+)/([0-9]+)/([0-9]+)$"
        ).unwrap();
        if let Some(captures) = re.captures(&request.target) {
            let index_name = &captures[1];
            let account: AccountNumber = captures[2].parse().unwrap();
            let begin: u64 = captures[3].parse().unwrap();
            let end: u64 = captures[4].parse().unwrap();

            // /messages/from/user/begin/end
            if index_name == "from" {
                // We named our secondary key "by_from"
                let index = message_table.get_index_by_from();

                return Some(HttpReply {
                    contentType: "application/json".into(),
                    body: serde_json::to_vec(
                        &index
                            .range((account, begin)..(account, end))
                            .collect::<Vec<_>>(),
                    )
                    .unwrap()
                    .into(),
                    headers: vec![],
                });
            }

            // /messages/to/user/begin/end
            if index_name == "to" {
                let index = message_table.get_index_by_to();

                return Some(HttpReply {
                    contentType: "application/json".into(),
                    body: serde_json::to_vec(
                        &index
                            .range((account, begin)..(account, end))
                            .collect::<Vec<_>>(),
                    )
                    .unwrap()
                    .into(),
                    headers: vec![],
                });
            }
        }

        serve_simple_ui::<Wrapper>(&request)
    }
}
```

We replaced the `/messages` query with two new ones. Let's try them out:

```
curl http://messages.psibase.127.0.0.1.sslip.io:8080/messages/from/alice/0/99999999 | jq
curl http://messages.psibase.127.0.0.1.sslip.io:8080/messages/to/bob/0/99999999 | jq
```

## Why Is It Empty?

The above queries should be empty, even if Alice and Bob exchanged messages before you upgraded the service. Many database engines automatically rescan tables when you add indexes. Psibase doesn't, since it has a potentially unbound execution time cost which would make busy chains unavailable for other users. Instead, psibase adds index entries only when putting rows. We could add an action which gradually reputs `n` rows of the table. For now, you can test the above by storing more messages.

## Modifying Tables And Indexes

The following corrupt tables:

- Changing the definition of an existing primary or secondary key.
- Renumbering the secondary keys.
- Renumbering the tables.
- Removing secondary keys. TODO: it may be possible to relax this in the future.
- Removing tables. TODO: it may be possible to relax this in the future.
- Changing the definitions of fields within tables.

There is an exemption to the last rule. You may add new `Option<...>` fields to the end of an existing table. You may not add non-option fields to an existing table, add fields to the middle of a table, change a field's type, or remove a field.

## Reading Tables in Test Cases

Let's make the following adjustment to Message. `Debug, PartialEq, Eq` aid testability. We also changed the fields to public.

```rust
#[table(name = "MessageTable", index = 0)]
#[derive(Debug, PartialEq, Eq, Fracpack, Reflect, Serialize, Deserialize)]
pub struct Message {
    #[primary_key]
    pub id: u64,

    pub from: AccountNumber,
    pub to: AccountNumber,
    pub content: String,
}
```

Add the following below the `service` module:

```rust
#[psibase::test_case(services("messages"))]
fn test_store_message(chain: psibase::Chain)
-> Result<(), psibase::Error> {
    use psibase::*;
    use service::*;

    chain.new_account(account!("alice")).unwrap();
    chain.new_account(account!("bob")).unwrap();

    // Create some messages. Verify the returned IDs.
    assert_eq!(
        Wrapper::push_from(&chain, account!("alice"))
            .storeMessage(account!("bob"), "hello Bob".into())
            .get()?,
        1
    );
    assert_eq!(
        Wrapper::push_from(&chain, account!("bob"))
            .storeMessage(account!("alice"), "hello Alice".into())
            .get()?,
        2
    );

    // Verify table content.
    //
    // We use `with_service` instead of `new` since `new` uses
    // `get_service` to look up which account the service is running
    // on. Since a test case is not a service, get_service() returns
    // 0. That causes the table to find no rows.
    assert_eq!(
        MessageTable::with_service(SERVICE)
            .get_index_pk()
            .iter()
            .collect::<Vec<_>>(),
        vec![
            Message {
                id: 1,
                from: account!("alice"),
                to: account!("bob"),
                content: "hello Bob".into()
            },
            Message {
                id: 2,
                from: account!("bob"),
                to: account!("alice"),
                content: "hello Alice".into()
            }
        ]
    );

    Ok(())
}
```

The following builds and runs the test:

```
cargo psibase test
```

## Storing Structs Defined Elsewhere

Sometimes services need to define tables whose struct isn't defined within the service module itself. Here's an example where we define the struct in the service's crate. It could also be defined in another library.

```rust
// This definition lives outside of the service module. We can't use
// `#[table]`, `#[primary_key]`, or `#[secondary_key]` here since
// those attributes are part of the `#[service]` macro.
#[derive(psibase::Fracpack, psibase::Reflect, serde::Serialize, serde::Deserialize)]
pub struct Message {
    pub id: u64,
    pub from: psibase::AccountNumber,
    pub to: psibase::AccountNumber,
    pub content: String,
}
```

```rust
// Inside the service module
#[table(name = "MessageTable", index = 0)]
#[derive(Fracpack, Reflect, Serialize, Deserialize)]
pub struct WrapMessage(crate::Message);

impl WrapMessage {
    #[primary_key]
    fn pk(&self) -> u64 {
        self.0.id
    }

    #[secondary_key(1)]
    fn by_from(&self) -> (AccountNumber, u64) {
        (self.0.from, self.0.id)
    }

    #[secondary_key(2)]
    fn by_to(&self) -> (AccountNumber, u64) {
        (self.0.to, self.0.id)
    }
}
```

`WrapMessage` falls under a special exemption to Fracpack, serde_json, and schema rules since it has exactly 1 unnamed field. All 3 formats treat `WrapMessage` as an alias to `Message` instead of treating it as a type which contains `Message`. e.g. They don't treat it as a tuple. They would treat it as a tuple if it contained more than 1 unnamed field.
