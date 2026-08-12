# @psibase/e2e

Playwright end-to-end tests for psibase. The suite runs against Chromium only.

## Prerequisites

Build psibase (or point the environment variables below at an unpacked psidk
tree). Install browser binaries once:

```bash
yarn playwright install chromium
```

## Environment variables

Both paths are relative to the repository root unless absolute:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PSINODE_BIN` | `build/psinode` | psinode binary |
| `PSIBASE_BIN` | `build/rust/release/psibase` | psibase CLI binary |

The config fails immediately (naming the variable) when either path is missing.
It also requires `share/psibase/packages` next to the psinode install prefix.

## Running the suite

From this directory:

```bash
yarn test
```

Artifacts (traces, videos, HTML report) are written to `test-results/`.
