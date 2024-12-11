This directory contains service (with plugins and UIs) templates that can be instantiated with `cargo generate`.

# Install

`cargo install cargo-generate`

# Usage

## Instantiating the template

> Only for Rust projects so far

Instanstiate a Rust service from Git:

`cargo generate --git gofractally/psibase` package-templates/rust

Instantiate a Rust package from local path in `services` directory.

`cargo generate -p ../../package-templates/rust`

## Building a package

1. Build the UI by running `yarn` and `yarn build` in the `ui/` directory.
2. From the root of the generated project, run `cargo-psibase package` to produce a .psi file in the `target/` directory (`./target/wasm32-wasi/release/packages/AppName.psi`).

   NOTE: `cargo-psibase package` will not build the UI, so step 1 above is required. Otherwise, your package will have no UI code.

3. `psibase install` with appropriate args will deploy the package to the chain.

# Resources used to build this project / Guiding docs

[Advice from actual usage](https://thoughtbot.com/blog/cargo-generate-lessons)
