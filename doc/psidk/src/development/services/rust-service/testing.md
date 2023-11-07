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

#[psibase::test_case(services("example"))]
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
     => transact-sys::
    raw_retval: 0 bytes
    action:
        transact-sys => auth-any-sys::checkauthsys
        raw_retval: 0 bytes
    action:
        example => example::add
        raw_retval: 4 bytes
        console:    Let's add 3 and 4
                    Hopefully the result is 7
ok

test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
```

## Manually Deploying A Service

`#[psibase::test_case(services("example"))]` automatically deployed the
`example` service to the `example` account on a test chain. We could
deploy it ourselves and gain some control.

```rust
// This time we don't have `services("example")` in the attribute arguments.
#[psibase::test_case]
fn manual_deploy(chain: psibase::Chain) -> Result<(), psibase::Error> {
    // Deploy the service
    chain.deploy_service(
        psibase::account!("another"), // Account to deploy on
        include_service!("example"),  // Service to deploy
    )?;

    // `push` defaulted the `service` and `sender` fields of the action to
    // `"example"`. We're using a different account now.
    assert_eq!(
        Wrapper::push_from_to(
            &chain,
            psibase::account!("another"), // sender
            psibase::account!("another")  // receiver
        )
        .add(3, 4)
        .get()?,
        7
    );

    Ok(())
}
```

`Chain::deploy_service` creates an account if it doesn't already exist and
installs a service on that account. Its second argument is a `&[u8]`, which
contains the service WASM.

The `include_service!` macro returns the service wasm as a `&[u8]`. Its
argument may be any of the following, assuming they define a service:

- The name of the current package
- The name of any package the current package depends on
- The name of any package in the current workspace, if any

The `include_service!` macro only exists within a `psibase::test_case`.

### Under The Hood

The `include_service!` macro uses prints to notify `cargo psibase test`
that it needs a service (Rust package). `cargo psibase test` builds that
package and sets an environment variable to let the macro know the final
location of the built WASM. `include_service!` then expands into
`include_bytes!` with the WASM's location.

The `services(...)` argument of the `test_case` macro expands to code which
uses `include_service!`.

## Next Step

Services may call other services; we show how to do this in
[Calling Other Services](calling.md).
