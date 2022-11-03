# GraphQL (Rust)

Rust services may use [async-graphql](https://async-graphql.github.io/async-graphql/en/index.html)
to serve GraphQL requests. The psibase library has built-in support
for it.

## Simple Example

```
cargo new --lib example_query
cd example_query
cargo add psibase async-graphql
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

Here are the service's links if you're hosting a local test chain:

- [http://example-query.psibase.127.0.0.1.sslip.io:8080/graphiql.html](http://example-query.psibase.127.0.0.1.sslip.io:8080/graphiql.html).
  This is GraphiQL, which lets you test your service's GraphQL
  queries and examine its schema.
- [http://example-query.psibase.127.0.0.1.sslip.io:8080/graphql](http://example-query.psibase.127.0.0.1.sslip.io:8080/graphql).
  The service hosts the GraphQL protocol here. If you do a GET at
  this location or click the link you'll receive the schema.
- [http://example-query.psibase.127.0.0.1.sslip.io:8080/](http://example-query.psibase.127.0.0.1.sslip.io:8080/).
  This is the developer UI, which lets you push transactions.

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
