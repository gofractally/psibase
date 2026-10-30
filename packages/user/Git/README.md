# Git

V1 proof of concept of git on Psibase. Spec: `git-on-psibase.md` in the repo root.

- `service/`: the on-chain `git` service (tables, `create`, `setWriter`, `removeWriter`, `putObjects`, `updateRefs`, dumb-HTTP `serveSys`).
- `../../../rust/git-remote-psibase`: the git remote helper.
- `test/git_e2e.py`: end-to-end tests that drive real `git` against a local node.

## Run locally

```sh
# build the package and the helper
(cd packages/user/Git && cargo-psibase package)          # needs psitest on PATH
(cd rust && cargo build -p git-remote-psibase --release)

# boot a dev node and install
psinode db -p prod -o psibase.localhost -l 8080 &
psibase boot -p prod
psibase install -y packages/user/target/wasm32-wasip1/release/packages/Git.psi

# *.psibase.localhost must resolve to 127.0.0.1 for git/python/reqwest
# (add git., transact., packages., homepage. to /etc/hosts if it does not)

PATH=$PWD/rust/target/release:$PATH python3 packages/user/Git/test/git_e2e.py
```
