# Test data

The code used to generate the sample wasms are found below: `example.wasm` file in this directory is below.
The command used to build these wasms is the same as what is used in the first step of `cargo psibase`:

```
cargo rustc --lib --crate-type=cdylib -p example --release --target=wasm32-wasi --message-format=json-diagnostic-rendered-ansi --color=always -- -C target-feature=+simd128,+bulk-memory,+sign-ext
```

## `simple.wasm`
```rust
#[psibase::service]
#[allow(non_snake_case)]
mod service {
    use psibase::*;
    #[action]
    pub fn add(a: i32, b: i32) -> i32 {
        a + b
    }

    #[action]
    pub fn multiply(a: i32, b: i32) -> i32 {
        a * b
    }

    #[action]
    #[allow(non_snake_case)]
    fn serveSys(request: HttpRequest) -> Option<HttpReply> {
        serve_simple_ui::<Wrapper>(&request)
    }
}
```

## `intermediate.wasm`
```rust
#[psibase::service]
#[allow(non_snake_case)]
mod service {
    use psibase::*;
    use serde::{Serialize, Deserialize};
    use async_graphql::*;
    
    #[table(name="AnswerTable", index=0)]
    #[derive(Fracpack, Reflect, Serialize, Deserialize)]
    pub struct Answer {
        #[primary_key]
        id: AccountNumber,

        result: i32,
    }

    #[action]
    pub fn add(a: i32, b: i32) -> i32 {
        let res = a + b;

        let answer_table = AnswerTable::new();
        answer_table.put(&Answer{
            id : get_sender(),
            result : res,
        }).unwrap();

        res
    }

    #[action]
    pub fn multiply(a: i32, b: i32) -> i32 {
        let res = a * b;

        let answer_table = AnswerTable::new();
        answer_table.put(&Answer{
            id : get_sender(),
            result : res,
        }).unwrap();

        res
    }

    struct Query;

    #[Object]
    impl Query {
        async fn add(&self, a: i32, b: i32) -> i32 {
            a + b
        }
    }

    #[action]
    #[allow(non_snake_case)]
    fn serveSys(request: HttpRequest) -> Option<HttpReply> {
        //serve_simple_ui::<Wrapper>(&request)
        None.or_else(|| serve_simple_ui::<Wrapper>(&request))
            .or_else(|| serve_graphql(&request, Query))
            .or_else(|| serve_graphiql(&request))
    }
}
```