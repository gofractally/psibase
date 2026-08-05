# SDK package templates (`cargo-generate`)

Out-of-tree app scaffold for `nix develop .#sdk` / `psidk-new`.

Unlike `package-templates/basic-01` (monorepo: Host WIT paths, `@shared` UI,
workspace-hack), this tree:

- Pins crates.io `psibase` / `psibase_macros` (see workspace `Cargo.toml`)
- Vendors Host / Transact / Permissions WIT under each app’s `plugin/wit/deps/`
- Ships a standalone Vite UI (runtime `@psibase/common-lib` from the chain)

## Usage

From an SDK workspace root (directory that contains `packages/Cargo.toml`):

```bash
psidk-new my-app
# or:
cargo generate -p "$PSIBASE_PACKAGE_TEMPLATES" --destination ./packages --init \
  -v --allow-commands --name my-app --define version=0.23.0
```

Then:

```bash
cd packages/MyApp/ui && yarn && yarn build
cd .. && cargo-psibase package
cargo-psibase install -a http://psibase.localhost:8090/
```
