# Testing Services (Rust)

Psibase extends Rust's unit and integration test system to support testing services.

## A Simple Test Case

Run the following to create a project:

```
cargo new --lib example
cd example
cargo add psibase
cargo add -F derive serde
```

This creates the following files:

```
example
├── Cargo.toml      Project configuration
├── Cargo.lock      Versions of dependencies
└── src
    └── lib.rs      Service source file
```

Replace the content of `lib.rs` with the following. This contains both the
service definition and some test cases for it:

```rust
#[psibase::service]
mod service {
    #[action]
    fn add(a: i32, b: i32) -> i32 {
        println!("Let's add {} and {}", a, b);
        println!("Hopefully the result is {}", a + b);
        a + b
    }

    #[action]
    fn multiply(a: i32, b: i32) -> i32 {
        println!("Let's multiply {} and {}", a, b);
        a * b
    }
}

#[psibase::test_case(packages("example"))]
fn test_arith(chain: psibase::Chain) -> Result<(), psibase::Error> {
    // Verify the actions work as expected.
    assert_eq!(Wrapper::push(&chain).add(3, 4).get()?, 7);
    assert_eq!(Wrapper::push(&chain).multiply(3, 4).get()?, 12);

    // Start a new block; this prevents the following transaction
    // from being rejected as a duplicate.
    chain.start_block();

    // Print a trace; this allows us to see:
    // * The service call chain. Something calls our service;
    //   let's see what it is!
    // * The service's prints, which are normally invisible
    //   during testing
    println!(
        "\n\nHere is the trace:\n{}",
        Wrapper::push(&chain).add(3, 4).trace
    );

    // If we got this far, then the test has passed
    Ok(())
}
```

Add the following to `Cargo.toml`. This will allow `cargo psibase` to build a psibase package from the crate.
```toml
[package.metadata.psibase]
package-name = "example"
```

## Running the Test

```
cargo psibase test
```

This command:

- Builds the service
- Builds the tests
- Runs the tests using `psitest`, which comes with the SDK

You should see output like the following:

```
running 1 test
test test_arith ...

Here is the trace:
action:
     => transact::
    raw_retval: 0 bytes
    action:
        transact => auth-any::checkauthsys
        raw_retval: 0 bytes
    action:
        example => example::add
        raw_retval: 4 bytes
        console:    Let's add 3 and 4
                    Hopefully the result is 7
ok

test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
```

## Next Step

Services may call other services; we show how to do this in
[Calling Other Services](calling.md).
