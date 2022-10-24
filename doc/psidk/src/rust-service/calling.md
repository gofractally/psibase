# Calling Other Services

We covered how to create transactions in test cases which call
services in the [previous chapter](testing.html). Now we'll cover
how services may call each other.

## A Tale of Two Services

Let's create two services, `arithmetic` and `arithmetic2`.

```
cargo new --lib arithmetic
cargo new --lib arithmetic2

# arithmetic needs the psibase and serde packages
cd arithmetic
cargo add psibase
cargo add -F derive serde

# arithmetic2 also needs arithmetic
cd ../arithmetic2
cargo add psibase
cargo add -F derive serde
cargo add --path ../arithmetic
```

This creates the following tree:

```
.
├── arithmetic
│   ├── Cargo.lock
│   ├── Cargo.toml
│   └── src
│       └── lib.rs
└── arithmetic2
    ├── Cargo.lock
    ├── Cargo.toml
    └── src
        └── lib.rs
```

Replace `arithmetic/src/lib.rs` with the following:

```rust
#[psibase::service]
mod service {
    #[action]
    fn add(a: i32, b: i32) -> i32 {
        a + b
    }
}
```

Replace `arithmetic2/src/lib.rs` with the following:

```rust
#[psibase::service]
mod service {
    #[action]
    fn mult_add(a: i32, b: i32, c: i32, d: i32) -> i32 {
        // Synchronous call to other service
        arithmetic::Wrapper::call().add(a * b, c * d)
    }
}

// Our test case needs both services to function
#[psibase::test_case(services("arithmetic", "arithmetic2"))]
fn test_arith(chain: psibase::Chain) -> Result<(), psibase::Error> {
    // Verify arithmetic works
    assert_eq!(arithmetic::Wrapper::push(&chain).add(3, 4).get()?, 7);

    // Verify arithmetic2 works
    assert_eq!(Wrapper::push(&chain).mult_add(3, 4, 5, 6).get()?, 42);

    Ok(())
}
```

## Try Them Out

Run the following from `arithmetic2/`. This will build both
services, build the test, and run it.

```
cargo psibase test
```

## Recursion Safety

By default, Rust services forbid recursive calls. This prevents
a series of exploits based on this pattern:

- Service `A` calls Service `B`
- Service `B` calls back into Service `A`

Service `A` may opt into allowing recursion by setting the
`recursive` option to true:

```
#[psibase::service(recursive = true)]
```

This requires very careful design to prevent exploits. The
following is a non-exhaustive list of potential attacks:

- `A` writes to a table, calls `B`, then writes to another
  table. Since it was in the middle of writing, `A`'s overall
  state is inconsistent. `B` calls a method on `A` which
  malfunctions because of the inconsistency between the
  two tables.
- `A` reads some rows from a table then calls `B`. `B` calls an
  action in `A` which modifies the table. When `B` returns,
  `A` relies on the previously-read, but now out of date,
  data.
- `A` calls `B` while iterating through a table index. `B` calls
  an action in `A` which modifies the table. When `B` returns,
  the iteration is now in an inconsistent state.

Rust's borrow checker doesn't prevent these attacks since
nothing is mutably borrowed long term. Tables wrap psibase's
[kv native functions](https://docs.rs/psibase/latest/psibase/native_raw/index.html),
which treat the underlying KV store as if it were in an
`UnsafeCell`. The Rust table wrappers can't protect against
this since it's possible, and normal under recursion, to create
multiple wrappers covering the same data range.

## Library Or Program?

We use `cargo new --lib` to create services. The top level is
`lib.rs` instead of `main.rs`. Does this mean that psibase
services are libraries?

They are in some ways, but not in others. The WASM spec doesn't
distinguish between libraries and programs. A WASM file contains
a set of exported functions which things on the outside can call
into. It also declares a set of imported functions that allow it
to call things outside of itself. This makes WASMs a lot like
libraries, but there's also a concept that makes them a lot like
programs: memory isolation. Unless a WASM exports its memory so
that other WASMs can import it, or imports its memory so another
WASM can provide it, the WASM's address space isn't accessible
to other WASMs, just like a program. Psibase doesn't currently
allow services to share memory with each other; it copies data
between them when necessary.

Cargo and the Rust compiler can build WASMs from either libraries
or programs. They have this tradeoff:

- A package may provide any number of programs, but at most 1 library.
- Programs and libraries may use definitions from other libraries, but not from other programs.

To make it easy for Rust service `A` to call Rust service `B`,
`A` needs to use wrapper definitions from `B`. If `B` is a
library, e.g. `lib.rs`, then this is easy. If `B` is a program,
e.g. `main.rs`, then this is impossible unless `B`'s package
defines both a program and a library. This would have
complicated the `psibase::service` attribute macro and forced
service authors to split their code between header-like files
and implementation-like files. We avoided this in most cases
by deciding that Rust services will be libraries. Both the
service macro and `cargo-psibase` make this assumption. We
made the opposite choice for C++ services; it's easier and
cleaner for CMake to build WASM from programs than it is from
libraries.
