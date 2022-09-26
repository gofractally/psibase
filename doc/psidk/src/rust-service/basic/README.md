# Basic Rust Service

## Not Yet Functional

This documents some of our current thoughts and ongoing development for Rust service support. The installation procedure and examples are currently non-functional.

## Installation

Follow the [Rust Installation Guide](../../rust.md).

## Getting Started

Run the following to create a project:

```
cargo new --lib example
cd example
cargo add psibase
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
pub mod service {
    #[action]
    pub fn add(a: i32, b: i32) -> i32 {
        a + b
    }

    #[action]
    pub fn multiply(a: i32, b: i32) -> i32 {
        a * b
    }
}
```

## Deploying the Service

This, if you have a [local test chain running](../../psibase#booting-a-chain), will:

- Build the service.
- Create the `example` account, if it doesn't already exist. The account won't be secured; anyone can authorize as this account without signing. Caution: this option should not be used on production or public chains. `-i` is a shortcut for `--create-insecure-account`.
- Deploy the just-built service on that account.

```sh
cargo psibase deploy -i example
```

## Psibase and Cargo

There are two related commands for interacting with psibase blockchains:

- The `psibase` utility knows how to interact with blockchains.
- `cargo psibase` builds, tests, and deploys Rust services on blockchains.

Here's an example of how they differ: `psibase deploy` has an argument which must point to an existing WASM. `cargo psibase deploy` builds and deploys the service identified by `Cargo.toml`.

## Testing the Service

The next section, [Testing Services](../testing) covers testing our service.

## Homework

There's a bug in both `add` and `multiply`. What is it? Even though it's still
a bug, and can be exploitable in some situations, how is it less dangerous in Rust
than it is in C++? How can you avoid it?
