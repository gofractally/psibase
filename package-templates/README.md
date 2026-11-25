# App templates

This directory contains app templates for `cargo-generate`. Each generated
package is a **stand-alone Cargo workspace** (service, query-service, plugin,
UI). It is not added to any parent workspace.

Plugin WIT for Host / Transact / Permissions is **vendored** under
`basic-01/.../plugin/wit/deps/`. When the template gains a new WIT dependency,
copy the corresponding `world.wit` into that tree and point
`plugin/Cargo.toml.liquid` at it.

Template hooks (`fill-version.rhai`, `fill-local-paths.rhai`) default the
psibase version from `rust/Cargo.toml` when inside a monorepo, and set
`local_path_psibase` / `local_path_psibase_macros` / `local_path_psibase_service`
to those crates (otherwise crates.io `={{version}}`). The generated app’s own
package version is always `0.0.1`.

# Install

`cargo install cargo-generate`

# Usage

## Instantiating the template

Use `instantiate-pkg.sh` when the destination is under a virtual workspace
(e.g. `packages/user`): it stages through a temp dir, then moves the result.
It exports `PSIBASE_INSTANTIATE_APP_DIR` so the hooks compute paths for the
final location.

```bash
./package-templates/instantiate-pkg.sh
# or:
./package-templates/instantiate-pkg.sh --destination ./packages/user --name my-app --version 0.29.0
```

Outside a virtual-workspace parent you can call `cargo generate` directly
against `./package-templates` (still pass `--allow-commands` so the hooks can
run). Prefer `instantiate-pkg.sh` in this repo.

## Building the app

1. From the app’s `ui/` subdirectory, run `yarn` and `yarn build`.
2. From the app’s root directory, run `cargo-psibase package`.
3. Use `cargo-psibase install` to install the package on a network.

# Additional resources

[Advice from actual usage](https://thoughtbot.com/blog/cargo-generate-lessons)
