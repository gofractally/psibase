# App templates

This directory contains app templates for `cargo-generate`. Each generated
package is a **stand-alone Cargo workspace** (service, query-service, plugin,
UI). It is not added to any parent workspace.

Plugin WIT for Host / Transact / Permissions is **vendored** under
`basic-01/.../plugin/wit/deps/`. When the template gains a new WIT dependency,
copy the corresponding `world.wit` into that tree and point
`plugin/Cargo.toml.liquid` at it.

# Install

`cargo install cargo-generate`

# Usage

## Instantiating the template

From the monorepo root (prompts for destination, name, and version when omitted;
version defaults to `rust/Cargo.toml` `[workspace.package]`):

```bash
./package-templates/new.sh
# or:
./package-templates/new.sh --destination ./packages/user --name my-app --version 0.29.0
```

`new.sh` pins `psibase` crates to this repo’s `rust/` via a relative path.
To use crates.io pins instead, pass an empty root through cargo-generate:

```bash
cargo generate -p ./package-templates --destination /path/to/parent --init \
  -v --allow-commands --name my-app --define psibase_rust_root= basic-01
```

## Building the app

1. From the app’s `ui/` subdirectory, run `yarn` and `yarn build`.
2. From the app’s root directory, run `cargo-psibase package`.
3. Use `cargo-psibase install` to install the package on a network.

# Additional resources

[Advice from actual usage](https://thoughtbot.com/blog/cargo-generate-lessons)
