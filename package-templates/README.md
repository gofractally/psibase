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

## Generate and add to workspace (single command)

```bash
./package-templates/generate-package.sh <project-name> <description>
```

Example:

```bash
./package-templates/generate-package.sh my-new-app "My new application"
```

This automatically:

1. Generates the package from the template
2. Adds it to `packages/user/Cargo.toml` workspace
3. Reports completion

## Building the app

1. From the app's `ui/` subdirectory, run `yarn` and `yarn build` to generate the UI:
   ```bash
   cd packages/user/YourPackageName/ui && yarn && yarn build
   ```
2. From the package directory, run `cargo-psibase package` to create a `.psi` file:
   ```bash
   cd packages/user/YourPackageName
   cargo-psibase package
   ```
3. Use `cargo-psibase install` to install the new app package to a network.

## Advanced: Add existing package to workspace only

If you've already generated a package and just need to add it to the workspace:

```bash
./package-templates/generate-package.sh YourPackageName
```

(Note: Use PascalCase name, no description argument)

# Additional resources

[Advice from actual usage](https://thoughtbot.com/blog/cargo-generate-lessons)
