# @psibase/e2e

Playwright end-to-end tests for psibase. The suite runs against Chromium only.

## Prerequisites

Build psibase (or point the environment variables below at an unpacked psidk
tree). Install browser binaries once:

```bash
yarn playwright install chromium
```

## Environment variables

When set, paths are relative to the repository root unless absolute. When
unset, `psinode` and `psibase` are resolved from `PATH` (direnv adds
`build/psidk/bin` and `build/rust/release`).

| Variable | Purpose |
| --- | --- |
| `PSINODE_BIN` | psinode binary |
| `PSIBASE_BIN` | psibase CLI binary |

The config fails immediately when a configured path is missing, when neither
variable is set and the command is absent from `PATH`, or when
`share/psibase/packages` is missing next to the psinode install prefix.

## CTest

From the build directory:

```bash
ctest -R e2e
```

Skips with exit code 77 when Chromium is not installed. Excluded from CI
container builds via `ctest -LE e2e`; the GitHub Actions `e2e` job runs the
suite on the runner instead.

## Running the suite

From this directory:

```bash
yarn test
```

Artifacts (traces, videos, HTML report) are written to `test-results/`.
