# App templates

This directory contains app templates that can be used with cargo-generate to quickly scaffold entire apps, including:

- Service
- Service unit tests
- HTTP/RPC Service
- Plugin
- UI

# Install

`cargo install cargo-generate@0.22.0`

# Usage

## Instantiating template and adding to workspace

From the root of the workspace, run:
`./package-templates/generate-package.sh <project-name>`

This will run a CLI wizard to set up the new app in the `./packages/user/` directory.

Example:

```bash
./package-templates/generate-package.sh MyNewApp
```

This will run a CLI wizard to set up the new app in the `./packages/user/` directory and add it to the `packages/user/Cargo.toml` workspace

## Building the app

1. From the app's `ui/` subdirectory, run `yarn` and `yarn build` to generate the UI.
2. From the app's root directory, run `cargo-psibase package` to create a `.psi` package file for the new app (`./target/wasm32-wasip1/release/packages/AppName.psi`).
   ```bash
   cd packages/user/YourPackageName
   cargo-psibase package
   ```
3. Use `cargo-psibase install` to install the new app package to a network.

# Additional resources

[Advice from actual usage](https://thoughtbot.com/blog/cargo-generate-lessons)
