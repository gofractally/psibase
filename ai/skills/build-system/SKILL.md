# Skill: build-system

**Name:** build-system  
**When to load:** Story involves CMake/make, adding packages to the repo, or build/debug configuration.  
**Prerequisites:** Repo layout (root CMakeLists.txt, packages/, rust/); distinction between Cargo and CMake builds.

---

## Core Knowledge

### Building via make (generally recommended)

#### Full build (entire repo, required baseline)

- **CMake / make (baseline):** Build the entire repo by entering the `build` dir and running CMake (if necessary) and then `make`. Use `.vscode/scripts/build.sh` only as a reference for the correct CMake options and generator; do not depend on it being present.
- **Baseline-first rule:** Before doing any feature work for a story, run a full-repo CMake/make build as a **baseline**. If this baseline build fails, treat that as a **hard stop**: do not modify code for the feature; instead, escalate with the baseline failure details so the build can be fixed first.
- **Logging pattern (to save tokens):** When running the full build, send the complete build output to a **temporary log file** (for example by piping through `tee` to a file created with `mktemp`), and only print a **filtered view** to stdout that keeps lines containing high-signal terms like `error`, `failed`, `warning`, or `success`. This keeps token usage low while still preserving full build details on disk if further inspection is needed.

#### Build a particular component

- Build a psibase package: `make <pkg name>`. Package names can be determined from CMakeLists.txt, but for psibase packages they're usually simply the package's dir name, e.g., `packages/user/<pkg name>/`.

### Building outside of make

Generally doing this is unnecessary; targets are determined by the contextually-relevant Cargo.toml, which is usually up the file tree in an ancestor path, e.g., `packages/user/Cargo.toml`. psibase package related build processes are generally wrapped by `cargo-psibase build`, which itself is the locally-built version of `cargo psibase build`. See the `cargo-psibase` code for further details if needed. The gist follows:

- Build services (WASM core modules): `cargo-psibase build`
- Build query services (WASM core modules): `cargo-psibase build`
- Build plugins (WASM components): `cargo component build`
- Build UIs: `yarn build`
- Build all components and produce a psibase package: `cargo-psibase package`
- Run tests: `cargo psibase test`.  

See the package's service's Cargo.toml to know which package components the package contains. Packages are not required to have any particular components; some are plugin-only; some are service-only. Package services can be written in Rust or C++. How packages are built is slightly different in the Cargo.tomls when C++ is involved or when the package contains no service.

**Rust workspace:** `packages/{user,system,local}/Cargo.toml` lists `workspace.members` and `exclude` (e.g. plugin-only crates). Add new Rust packages there for `cargo psibase` to see them. Depending on whether the package contains a C++ service or no service at all, mirror an existing package with the same component mix when updating Cargo.toml.

Refs: `ai/docs/psibase/build-system.md`, `doc/src/development/services/rust-service/package.md`.

---

## Skill: add-package

- **Rust-only package (no CMake):** Create a crate with `[package.metadata.psibase]` (package-name, services, server, plugin, data, postinstall as needed). If it lives under the repo, add it to the workspace `members` in the appropriate root Cargo.toml (e.g. `packages/user/Cargo.toml`). Build with `cargo psibase build` or `cargo psibase install` from the package root.
- **Package in repo CMake:** Under `packages/user/`, add a new subdirectory. In its CMakeLists.txt call `add_user_service("${suffix}" Name src/Name.cpp)` (and optionally a Rust stub like `RName`). In `packages/user/CMakeLists.txt`, add `add_subdirectory(NewPkg)` inside the `if(DEFINED IS_WASM)` block. For Rust, also add the crate(s) to `packages/user/Cargo.toml` `workspace.members` so `cargo psibase` can build them.

---

## Skill: make-targets

- From the repo root, `make` targets are defined by the top-level Makefile or CMake. Common targets might include building psinode, psitest, or specific packages. Check root `CMakeLists.txt` and any `Makefile` for the exact target names (e.g. `make psibase`, `make psinode`). Building a single package may be a CMake target or a make wrapper; refer to project docs or CI.

---

## Skill: debug-build

- **Rust service:** `cargo build --target wasm32-wasip1`; ensure `psibase` and macros resolve (workspace or path deps). Fix missing symbols by checking Cargo.toml and that the service is a lib.
- **Plugin:** `cargo component build`; “missing import” usually means WIT or dependency is wrong — verify Cargo.toml, WIT include/import, and Rust use (three-place rule). Wrong target (e.g. wasm32-wasip1 vs wasm32-unknown-unknown) can also cause link errors; check the plugin crate’s target.
- **CMake:** Use an out-of-tree build dir; check `ROOT_BINARY_DIR`, `WASI_SDK_PREFIX`, and that user subdirs are included when `IS_WASM` is set. For Rust tests driven by CMake, ensure `--psitest=` and manifest path point to the right locations.

---

## Gotchas

- **Placeholder crates:** Do not rely on `cargo install psibase psinode psitest` from crates.io; use repo-built or SDK executables.
- **Plugin target:** Plugins may use a different wasm target than services; confirm in the plugin’s Cargo.toml or CI.
- **Baseline failures are hard stops:** If the initial full-repo CMake/make build (run before you start feature work) fails, do not proceed with implementing the story. Record the failure (including a filtered summary of the log) and escalate so the build can be fixed first.

---

## Verification

- **Required full rebuild:** A **successful full-repo rebuild** from the existing build directory, using CMake/make, is required for work to be considered complete. You do not need to wipe the build directory; just reconfigure if necessary and ensure `make` finishes without errors.
- **Package-level checks:** In addition to the full-repo build, run the smallest relevant package or component builds (for example `make <pkg>`, `cargo-psibase build`, or `cargo component build`) while developing to get faster feedback.
- **Tests:** Where available, run `cargo psibase test` for the packages you touched and/or CTest from the build dir. Treat failing tests as blockers for completion until they pass or are explicitly escalated.

---

## Related Skills

- **service-tables**, **service-actions**, **plugin-wasm** — code that the build compiles.
- **plugin-dependencies** — fixes for plugin build failures.

---

## References

- `ai/docs/psibase/build-system.md`
- Root `CMakeLists.txt`, `packages/CMakeLists.txt`, `packages/user/CMakeLists.txt`, `packages/user/Cargo.toml`
- `doc/src/development/services/rust-service/package.md`
