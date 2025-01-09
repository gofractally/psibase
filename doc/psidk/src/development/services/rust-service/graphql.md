# GraphQL (Rust)

Rust services may use [async-graphql](https://async-graphql.github.io/async-graphql/en/index.html)
to serve GraphQL requests. The psibase library has built-in support
for it.

## Simple Example

```
cargo new --lib example_query
cd example_query
cargo add psibase async-graphql rand rand_chacha
cargo add -F derive serde
```

```rust
#[allow(non_snake_case)]
#[psibase::service]
mod service {
    use async_graphql::*;
    use psibase::*;

    // Root query object
    struct Query;

    #[Object] // This is an async_graphql attribute
    impl Query {
        /// Compute `a + b`.
        ///
        /// This documentation automatically appears
        /// in the GraphQL schema for `add`.
        async fn add(&self, a: i32, b: i32) -> i32 {
            a + b
        }
    }

    #[action]
    fn serveSys(request: HttpRequest) -> Option<HttpReply> {
        None.or_else(|| serve_simple_ui::<Wrapper>(&request))
            .or_else(|| serve_graphql(&request, Query))
            .or_else(|| serve_graphiql(&request))
    }
}
```

## Trying It Out

```
# Build and deploy the service
cargo psibase deploy -ip
```

If you're running psibase locally, you can follow the [minimal UI instructions](./minimal-ui.md#trying-the-ui) to connect to the `example-query` service. You should be able to access:

- The `/graphiql.html` endpoint: This is GraphiQL, which lets you test your service's GraphQL queries and examine its schema.
- The `/graphql` endpoint: The service hosts the GraphQL protocol here. If you do a GET at this location or click the link you'll receive the schema.
- The `/` endpoint: This is the developer UI, which lets you push transactions.

Try running the following query:

```
{
    add(a: 3, b: 10)
}
```

You may use labels to query the same function more than once:

```
{
    x: add(a: 3, b: 4)
    y: add(a: 10, b: 20)
}
```

## Table Access

We need some data to query. Let's build on the example from the
[Tables Section](tables.md).

```rust
#[psibase::service_tables]
mod tables {
    use async_graphql::*;
    use serde::{Deserialize, Serialize};

    #[table(name = "MessageTable", index = 0)]
    #[derive(Fracpack, Reflect, Serialize, Deserialize, SimpleObject)]
    pub struct Message {
        #[primary_key]
        pub id: u64,
        pub from: AccountNumber,
        pub to: AccountNumber,
        pub content: String,
    }

    // A variety of secondary keys to support queries
    impl Message {
        #[secondary_key(1)]
        fn by_from(&self) -> (AccountNumber, u64) {
            (self.from, self.id)
        }

        #[secondary_key(2)]
        fn by_to(&self) -> (AccountNumber, u64) {
            (self.to, self.id)
        }

        #[secondary_key(3)]
        fn by_from_to(&self) -> (AccountNumber, AccountNumber, u64) {
            (self.from, self.to, self.id)
        }

        #[secondary_key(4)]
        fn by_to_from(&self) -> (AccountNumber, AccountNumber, u64) {
            (self.to, self.from, self.id)
        }
    }

    #[table(name = "LastUsedTable", index = 1)]
    #[derive(Default, Fracpack, Reflect, Serialize, Deserialize)]
    pub struct LastUsed {
        lastMessageId: u64,
    }

    impl LastUsed {
        #[primary_key]
        fn pk(&self) {}
    }
}

#[allow(non_snake_case)]
#[psibase::service]
mod service {
    use async_graphql::*;
    use psibase::{AccountNumber, *};
    use rand::prelude::*;

    use crate::tables::{Message, MessageTable, LastUsed, LastUsedTable};

    fn get_next_message_id() -> u64 {
        let table = LastUsedTable::new();
        let mut lastUsed = table.get_index_pk().get(&()).unwrap_or_default();
        lastUsed.lastMessageId += 1;
        table.put(&lastUsed).unwrap();
        lastUsed.lastMessageId
    }

    fn store(from: AccountNumber, to: AccountNumber, content: String) -> u64 {
        let message_table = MessageTable::new();
        let id = get_next_message_id();
        message_table
            .put(&Message {
                id,
                from,
                to,
                content,
            })
            .unwrap();
        id
    }

    #[action]
    fn storeMessage(to: AccountNumber, content: String) -> u64 {
        store(get_sender(), to, content)
    }

    // Randomly generate messages
    #[action]
    fn generateRandom(numMessages: u32, seed: u64, users: Vec<AccountNumber>) {
        const WORDS0: &[&str] = &["run", "stop", "play", "resume", "hit", "break", "take"];
        const WORDS1: &[&str] = &["funny", "fast", "slow", "quiet", "loud", "red", "blue"];
        const WORDS2: &[&str] = &["breaks", "food", "bicycles", "houses", "property", "ideas"];
        const WORDS3: &[&str] = &["or", "and", "then"];
        let mut rnd = rand_chacha::ChaCha8Rng::seed_from_u64(seed);
        for _ in 0..numMessages {
            store(
                *users.iter().choose(&mut rnd).unwrap(),
                *users.iter().choose(&mut rnd).unwrap(),
                format!(
                    "{} {} {} {} {} {} {}",
                    WORDS0.iter().choose(&mut rnd).unwrap(),
                    WORDS1.iter().choose(&mut rnd).unwrap(),
                    WORDS2.iter().choose(&mut rnd).unwrap(),
                    WORDS3.iter().choose(&mut rnd).unwrap(),
                    WORDS0.iter().choose(&mut rnd).unwrap(),
                    WORDS1.iter().choose(&mut rnd).unwrap(),
                    WORDS2.iter().choose(&mut rnd).unwrap(),
                ),
            );
        }
    }

    #[action]
    fn serveSys(request: HttpRequest) -> Option<HttpReply> {
        None.or_else(|| serve_simple_ui::<Wrapper>(&request))
            .or_else(|| serve_graphql(&request, Query))
            .or_else(|| serve_graphiql(&request))
    }
}
```

The above won't build until we define our Query root. Let's start with something simple:

```rust
struct Query;

#[Object]
impl Query {
    // Get the first n messages
    async fn messages(&self, n: u32) -> Vec<Message> {
        MessageTable::new()
            .get_index_pk()
            .iter()
            .take(n as usize)
            .collect()
    }
}
```

## Trying it out

```
cargo psibase deploy -ip

psibase create -i alice
psibase create -i bob
psibase create -i frank
psibase create -i jennifer
psibase create -i joe
psibase create -i sue
```

If you're running psibase locally, you can follow the [minimal UI instructions](./minimal-ui.md#trying-the-ui) to connect to the `example-query` service.

Use `generateRandom` to create messages.

- Use `1000` for `numMessages`.
- Use `["alice","bob","frank","jennifer","joe","sue"]` for `users`.

Access the `/graphiql.html` endpoint on this service, and run the following query:

```
{
  messages(n: 10) {
    id
    from
    to
    content
  }
}
```

## Pagination

Our query above can limit the amount of data we retrieve, but doesn't support
paging through the data. The [TableQuery](https://docs.rs/psibase/latest/psibase/struct.TableQuery.html)
type gives us that capability. As a bonus, it supports the
[GraphQL Pagination Spec](https://graphql.org/learn/pagination/).

Update the query with the following:

```rust
use async_graphql::connection::Connection;

#[Object]
impl Query {
    async fn messages(
        &self,
        first: Option<i32>,
        last: Option<i32>,
        before: Option<String>,
        after: Option<String>,
    ) -> async_graphql::Result<Connection<RawKey, Message>> {
        TableQuery::new(MessageTable::new().get_index_pk())
            .first(first)
            .last(last)
            .before(before)
            .after(after)
            .query()
            .await
    }
}
```

> ➕ TODO: reduce boilerplate

After you deploy it, you should be able to run the following query, which fetches the first 10 records:

```
{
  messages(first: 10) {
    pageInfo { startCursor endCursor hasNextPage hasPreviousPage }
    edges { node { id from to content } }
  }
}
```

You should get a result similar to this:

```json
{
  "data": {
    "messages": {
      "pageInfo": {
        "startCursor": "C0A0503DE04597060000000000000000000001",
        "endCursor": "C0A0503DE0459706000000000000000000000A"
      },
      "edges": [
        {
          "node": {
            "id": 1,
            "from": "joe",
            "to": "joe",
            "content": "resume quiet property and run fast ideas"
          }
        },
...
```

You can get the next 10 records by copying the value from `endCursor` above into this query:

```
{
  messages(first: 10, after: "C0A0503DE0459706000000000000000000000A") {
    pageInfo { startCursor endCursor hasNextPage hasPreviousPage }
    edges { node { id from to content } }
  }
}
```

`TableQuery` supports primary or secondary indexes. Let's add the following:

```rust
async fn messagesByFrom(
    &self,
    first: Option<i32>,
    last: Option<i32>,
    before: Option<String>,
    after: Option<String>,
) -> async_graphql::Result<Connection<RawKey, Message>> {
    TableQuery::new(MessageTable::new().get_index_by_from())
        .first(first)
        .last(last)
        .before(before)
        .after(after)
        .query()
        .await
}
```

Now we can get the result sorted by the sender:

```
{
  messagesByFrom(first: 10) {
    pageInfo { startCursor endCursor hasNextPage hasPreviousPage }
    edges { node { id from to content } }
  }
}
```

## Subindexes

So far `messagesByFrom` allows us to page through messages sorted by
sender, but it doesn't allow us to fetch messages by a particular sender.
We can use `TableQuery` subindex support to do this.

```rust
async fn messagesByFrom(
    &self,
    from: AccountNumber,
    first: Option<i32>,
    last: Option<i32>,
    before: Option<String>,
    after: Option<String>,
) -> async_graphql::Result<Connection<RawKey, Message>> {
    TableQuery::subindex::<u64>(
        MessageTable::new().get_index_by_from(), &from)
        .first(first)
        .last(last)
        .before(before)
        .after(after)
        .query()
        .await
}
```

`TableQuery::subindex` holds the first field(s) of a key constant, while
searching and iterating through the remaining fields of the key. The
type argument, `u64` in this case, specifies the types of the remaining
fields. If there's more than 1 remaining field, then use a tuple. The
second argument, `from` in this case, provides the key fields that remain
constant. If there's more than 1 field, then use a tuple.

The following query should work:

```
{
  messagesByFrom(first: 10, from: "bob") {
    pageInfo { startCursor endCursor hasNextPage hasPreviousPage }
    edges { node { id from to content } }
  }
}
```

`subindex` has this signature:

```rust
pub fn subindex<RemainingKey: ToKey>(
    table_index: TableIndex<Key, Record>,
    subkey: &impl ToKey,
) -> TableQuery<RemainingKey, Record> {
```

subindex doesn't to any type checking. If `Key` is a tuple of `(T1, T2, T3, ...)`,
or a struct with fields of type `T1, T2, T3, ...`, then the subkey's
type must either match `T1` exactly, be a tuple of types that match the
first n fields of `(T1, T2, T3, ...)`, or be a struct with fields that
have types which match the first n fields. `RemainingKey` must have the
remaining types, but it's OK to truncate them. e.g. if the remaining
types are `u32, String`, it's OK for `RemainingKey` to be just `u32`.

If the types don't match up correctly, then the query will malfunction.
