# Basic Service (Rust)

## Installation

Follow the [Rust Installation Guide](../setup.md).

## Getting Started

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

You don't need to manually make any changes to `Cargo.toml` to follow the examples in this book. Contrary to other Rust WASM guides, _do not_ add a `crate-type` entry to `Cargo.toml`; cargo-psibase doesn't need it and it can cause problems in some situations. You should never edit `Cargo.lock` by hand.

Replace the content of `lib.rs` with the following. This is our initial service:

```rust
#[psibase::service]
mod service {
    #[action]
    fn add(a: i32, b: i32) -> i32 {
        a + b
    }

    #[action]
    fn multiply(a: i32, b: i32) -> i32 {
        a * b
    }
}
```

## Deploying the Service

If you have a local chain running, run: 

```sh
cargo psibase deploy -i example
```

This will:
- Build the service.
- Create the `example` account, if it doesn't already exist. The account won't be secured; anyone can authorize as this account without signing. Caution: this option should not be used on production or public chains. `-i` is a shortcut for `--create-insecure-account`.
- Deploy the just-built service on that account.

See the [psibase cli docs](../../../../run-infrastructure/cli/psibase.md#deploy) for more information on `psibase deploy`.

## Where's the pub?

The `service` module and the actions within it don't need to be public. Instead, the `psibase::service` macro generates public definitions which wrap the actions. You don't need to make the actions public to document them; the macro copies documentation from the action definitions to the generated definitions. It also copies documentation from the `service` module.

## Psibase and Cargo

There are two related commands for interacting with psibase blockchains:

- The `psibase` utility knows how to interact with blockchains.
- `cargo psibase` builds, tests, and deploys Rust services on blockchains.

Here's an example of how they differ: `psibase deploy` has an argument which must point to an existing WASM. `cargo psibase deploy` builds and deploys the service identified by `Cargo.toml`.

## Testing the Service

The next section, [Testing Services](../testing.md) covers testing our service.
