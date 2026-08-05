# Psibase package workspace

Scaffolded with:

```bash
nix flake init -t github:gofractally/psibase/mm/nix-pkg-dev#package
```

## Layout

```text
.
├── flake.nix / .envrc      # pulls in psibase#sdk
└── packages/
    ├── Cargo.toml          # workspace (crates.io psibase pin)
    └── <App>/              # from `psiapp new` — service, query, plugin, ui
```

## Develop

```bash
direnv allow   # or: nix develop
psiapp chain up 8090  # avoid ports already in use (e.g. 8080)

psiapp new my-app
cd packages/MyApp/ui && yarn && yarn build
cd .. && cargo-psibase package
cargo-psibase install -a http://psibase.localhost:8090/

psiapp chain down
```

Use the SDK shell’s `psibase` (same release as the chain). A monorepo `build/`
`psibase` from a newer train will mis-encode account names on an SDK-booted chain.

`packages/Cargo.lock` (after the first `cargo` / `cargo-psibase` run) should be
committed so Cargo does not pull crates that need a newer rustc than the SDK pin.
