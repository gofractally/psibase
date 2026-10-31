# Git

V1 proof of concept of git on Psibase. Spec: `git-on-psibase.md` in the repo root.

- `service/`: the on-chain `git` service (tables, `create`, `setWriter`, `removeWriter`, `putObjects`, `updateRefs`, dumb-HTTP `serveSys`).
- `../../../rust/git-remote-psibase`: the git remote helper.
- `service/src/install.sh`: the installer template; `serveSys` renders it at `git.<root>/install.sh`.
- `scripts/pack-install-dist.sh`: packs the helper tarballs, `SHA256SUMS.txt` and `version.txt` into `install-dist/` (not committed), which the package uploads to Sites under `/install`.
- `test/git_e2e.py`: end-to-end tests that drive real `git` against a local node.

## Run locally

```sh
# build the package and the helper
(cd packages/user/Git && cargo-psibase package)          # needs psitest on PATH
(cd rust && cargo build -p git-remote-psibase --release)

# optional: fill install-dist so the package serves the installer's tarballs
(cd rust && cargo build -p git-remote-psibase --profile dist --target x86_64-unknown-linux-musl)
packages/user/Git/scripts/pack-install-dist.sh dev \
    x86_64=rust/target/x86_64-unknown-linux-musl/dist/git-remote-psibase

# boot a dev node and install
psinode db -p prod -o psibase.localhost -l 8080 &
psibase boot -p prod
psibase install -y packages/user/target/wasm32-wasip1/release/packages/Git.psi

# *.psibase.localhost must resolve to 127.0.0.1 for git/python/reqwest
# (add git., transact., packages., homepage. to /etc/hosts if it does not)

PATH=$PWD/rust/target/release:$PATH python3 packages/user/Git/test/git_e2e.py
```
