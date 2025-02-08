# Test data

The code used to generate the sample wasm is found below.

The command used to build these wasms is the same as what is used in the first step of `cargo psibase`:
```
cargo rustc --lib --crate-type=cdylib -p example --release --target=wasm32-wasip1 --message-format=json-diagnostic-rendered-ansi --color=always -- -C target-feature=+simd128,+bulk-memory,+sign-ext
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
