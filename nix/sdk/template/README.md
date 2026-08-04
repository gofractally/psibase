# Psibase package workspace

Scaffolded with:

```bash
nix flake init -t github:gofractally/psibase#package
# or from a local checkout:  nix flake init -t path:/path/to/psibase#package
```

## Layout

```text
.
├── Cargo.toml              # workspace
├── packages/
│   └── example/            # first app — rename / add siblings here
├── flake.nix               # pulls in `devShells.sdk` from psibase
└── .envrc                  # direnv → nix develop .#sdk
```

## Develop

```bash
direnv allow   # or: nix develop
psidk-up       # local chain + boot (API http://psibase.localhost:8080/)
cd packages/example
cargo-psibase package
cargo-psibase install -a http://psibase.localhost:8080/
psidk-down
```

`Cargo.lock` is committed so Cargo does not pull transitive crates that need a
newer rustc than the SDK’s Rust 1.86 pin.

While the SDK flake lives only on a development branch, override the input:

```bash
nix flake lock --override-input psibase path:/path/to/psibase
```
