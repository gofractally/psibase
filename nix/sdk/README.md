# Package-dev SDK (`packages.psidk`)

Rust-oriented SDK for building psibase packages **without** cloning this monorepo.
See [`../sdk-dx-plan.md`](../sdk-dx-plan.md).

```bash
nix build .#psidk
./result/bin/psibase --version
```

## What it is

Repackages the GitHub Releases `psidk-ubuntu-2404.tar.gz` (same pin as
`packages.psibase` in [`../release.nix`](../release.nix)), patchelf’d for Nix:

| Included | Excluded (Rust-only) |
|----------|----------------------|
| `bin/{psinode,psibase,psitest}` | `share/wasi-sysroot` (~241M) |
| `bin/cargo-psibase` when present in the tarball | `share/psibase/cmake` |
| Full `share/psibase/packages` | `bin/psidk-cmake-args` |
| `share/psibase/{config.in,wasm,services,python,licenses}` | `share/gdb` |
| man pages | |

Layout contract: `$out/{bin,share/psibase}` — tools resolve data from the
executable path (`…/bin` → `…/share/psibase`). Override with `PSIBASE_DATADIR`
when needed (same as classic psidk).

## `cargo-psibase` gap (v0.23.0-pre)

The current release tarball does **not** include `bin/cargo-psibase` (CMake
only installed `psibase` into the Client component). This tree now installs
`cargo-psibase` into the Client component so the **next** tagged release will
ship it; `packages.psidk` installs it when present.

## Not this package

- Contributor toolchain → `nix develop` / `nix/dev/shell.nix`
- Thin node runtime / NixOS module → `packages.psibase` / `nix/deploy/`
- `devShells.sdk`, templates, local-chain helper → later plan phases
