# App templates

This directory contains app templates that can be used with cargo-generate to quickly scaffold entire apps, including:

- Service
- Service unit tests
- HTTP/RPC Service
- Plugin
- UI

# Install

`cargo install cargo-generate`

# Usage

## Instantiating the template

From the root of the workspace, run:
`cargo generate -p ./package-templates/ --destination ./services/user/ --init -v`

This will run a CLI wizard to set up the new app in the `./services/user/` directory.

## Building the app

1. From the app's `ui/` subdirectory, run `yarn` and `yarn build` to generate the UI.
2. From the app's root directory, run `cargo-psibase package` to create a package file for the new app (`./target/wasm32-wasi/release/packages/AppName.psi`).
3. Use `cargo-psibase install` to install the new app package to a network.

# Additional resources

[Advice from actual usage](https://thoughtbot.com/blog/cargo-generate-lessons)
