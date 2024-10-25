# Core macros for Psibase

This defines the core functions that back the macros for the [fracpack crate](https://docs.rs/fracpack) and
[psibase crate](https://docs.rs/psibase). See the documentation for those crates.

## Service macro test suite

There are 2 parts to the suite.

- Unit testing, which largely tests boundary conditions and failure cases.Run `cargo test` in the `./psibase-macros-lib/` subdir.
- functional testing (kinda) which exercises the service after it is transformed by the macro. Run `cargo-psibase test` in `../test_psibase_macros`.
