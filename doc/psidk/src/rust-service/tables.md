# Tables (Rust)

Services store data in psibase's key-value store, normally using tables.

## A simple table

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
    //
    // We need the following derives on Message:
    // - Fracpack since tables use it to store data and
    //   so we can return it from actions
    // - Reflect so serve_simple_ui can generate
    //   the schema and action templates
    // - Serialize so we can convert it to JSON
    // - Deserialize so we can convert it from JSON
    #[table(name = "MessageTable", index = 0)]
    #[derive(Fracpack, Reflect, Serialize, Deserialize)]
    pub struct Message {
        // Every message has a unique key. This doesn't have to be
        // a u64; we could have used a String, a Vec, a tuple,
        // or even another struct. It also doesn't have to be a
        // field; the #[primary_key] attribute works on methods.
        // It's common to have a primary key method which returns
        // a tuple containing field values.
        #[primary_key]
        id: u64,

        from: AccountNumber,
        to: AccountNumber,
        content: String,
    }

    // Store a message
    #[action]
    fn storeMessage(id: u64, to: AccountNumber, content: String) {
        // Open the table. #[table(...)] defined the MessageTable type.
        let message_table = MessageTable::open();

        // This will overwrite any messages with the same ID, including
        // messages from other users. It also allows users to insert
        // messages out of order. We'll fix both issues below.
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
        let message_table = MessageTable::open();

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

## Trying it out

```
# Deploy the service
cargo psibase deploy -ip

# Create some test users
psibase create -i alice
psibase create -i bob
psibase create -i sue
```

If you're running psibase locally, you should be able to

- Connect to [http://messages.psibase.127.0.0.1.sslip.io:8080/](http://messages.psibase.127.0.0.1.sslip.io:8080/)
- Use `storeMessage` to create messages between accounts
- Use `getMessages`

`getMessages` makes it possible for other services to retrieve messages without
accessing this service's tables directly. However, there isn't currently a way
for javascript to get decoded return values (TODO), so the developer UI shows
hex in the transaction trace. It's also wasteful in most cases to push
transactions just to run a query. We can add a custom RPC endpoint to address
these issues.

## Custom RPC

Replace `serveSys` with the following. This handles RPC requests of the form
`/messages/begin/end`, where `begin` and `end` are integer keys. This returns
messages in range as JSON.

```rust
#[action]
fn serveSys(request: HttpRequest) -> Option<HttpReply> {
    let re = regex::Regex::new("^/messages/([0-9]+)/([0-9]+)$").unwrap();
    if let Some(captures) = re.captures(&request.target) {
        return Some(HttpReply {
            contentType: "application/json".into(),
            body: serde_json::to_vec(&getMessages(
                captures[1].parse().unwrap(),
                captures[2].parse().unwrap(),
            ))
            .unwrap(),
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

A singleton is a table that has at most 1 row. Let's add one to track the
most-recent message ID so we can keep messages in order.

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
    #[derive(Fracpack, Reflect, Serialize, Deserialize)]
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
        let table = LastUsedTable::open();

        // Get record, if any
        let mut lastUsed = if let Some(record) = table.get_index_pk().iter().next() {
            record
        } else {
            LastUsed { lastMessageId: 0 }
        };

        // Update lastMessageId
        lastUsed.lastMessageId += 1;
        table.put(&lastUsed).unwrap();
        lastUsed.lastMessageId
    }

    // The caller no longer provides an ID; we return it instead.
    #[action]
    fn storeMessage(to: AccountNumber, content: String) -> u64 {
        let message_table = MessageTable::open();
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
        let message_table = MessageTable::open();
        let index = message_table.get_index_pk();
        index.range(begin..end).collect()
    }

    // Same as before
    #[action]
    fn serveSys(request: HttpRequest) -> Option<HttpReply> {
        let re = regex::Regex::new("^/messages/([0-9]+)/([0-9]+)$").unwrap();
        if let Some(captures) = re.captures(&request.target) {
            return Some(HttpReply {
                contentType: "application/json".into(),
                body: serde_json::to_vec(&getMessages(
                    captures[1].parse().unwrap(),
                    captures[2].parse().unwrap(),
                ))
                .unwrap(),
                headers: vec![],
            });
        }

        serve_simple_ui::<Wrapper>(&request)
    }
}
```

You should be able to try this as before. This time however, `storeMessage`
returns an ID; users can't post messages out of order or overwrite other
users' messages, except for a new bug.

We modified the behavior of an already-deployed service and introduced a
bug in the process. The new version gradually overwrites messages created
by the previous version. Production services need to be very careful with
upgrades.
