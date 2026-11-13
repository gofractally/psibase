# @psibase/e2e

Playwright end-to-end harness for psibase. This package owns Playwright setup
(config, browser projects, CTest and CI wiring, binary and package resolution)
and Yarn PnP. Specs live next to each service under `packages/**/e2e/`.

## Package suites

Each UI/service suite is a small package at `packages/<path>/e2e` with its own
`package.json` (`@psibase/<name>-e2e`). This harness pins and runs
`@playwright/test`. Suite packages must also list every package their specs
import (including `@playwright/test` at the same version, plus suite-only deps
like `bcryptjs`); Yarn reuses `../.caches/yarn` so that is not a second
download. Portal the suite into this package:

```json
"dependencies": {
    "@psibase/xadmin-e2e": "portal:../packages/local/XAdmin/e2e"
}
```

Then `yarn install` here. Downloads reuse `../.caches/yarn` with the packages
workspace.

`playwright.config.ts` discovers all `packages/**/e2e/**/*.spec.ts`. Narrow a
run by path or title:

```bash
yarn test --project=chromium ../packages/local/XAdmin/e2e
yarn test --project=chromium -g "Private"
```

## Prerequisites

Build psibase (or point the environment variables below at an unpacked psidk
tree). Chromium and WebKit for the Playwright version pinned in `package.json`
(`@playwright/test`) come from the environment — do not run `playwright install`:

- **CI / Ubuntu builder images** ([image-builders](https://github.com/gofractally/image-builders)):
  browsers under `PLAYWRIGHT_BROWSERS_PATH`
- **Nix / NixOS:** `nix develop` sets the same (see `nix/README.md`)

A browser that isn't available makes its CTest skip (exit code 77) rather than
fail the build.

## Environment variables

When set, paths are relative to the repository root unless absolute. When
unset, `psinode` and `psibase` are resolved from `PATH` (direnv adds
`build/psidk/bin` and `build/rust/release`).

| Variable | Purpose |
| --- | --- |
| `PSINODE_BIN` | psinode binary |
| `PSIBASE_BIN` | psibase CLI binary |
| `PSIBASE_PACKAGES` | optional directory of `.psi` packages (e.g. locally built ones); defaults to `share/psibase/packages` next to the psinode install prefix |
| `E2E_PEERING_SYNC` | XAdmin peering: unset/`1` waits for joiner sync + peers page; `0` stops after Connect (CI quick path) |

The config fails immediately when a configured path is missing, when neither
binary variable is set and the command is absent from `PATH`, or when no
package directory can be found.

## CTest

From the build directory:

```bash
ctest -L e2e            # all e2e tests
ctest -R e2e-chromium   # one browser
ctest -R e2e-webkit
```

Each browser project is its own CTest entry, registered with
`psibase_add_e2e_test(<name> <browser> [playwright args...])` in
`CMakeLists.txt`; extra args can narrow a test to a spec folder. Excluded from
CI container builds via `ctest -LE e2e`; the GitHub Actions `e2e` job runs the
suite inside the Ubuntu 22.04 builder image (browsers already present).

## Running the suite

From this directory:

```bash
yarn test                      # all discovered package suites
./run-ctest.sh webkit [args]   # one browser, as CTest runs it
```

Artifacts (traces, videos, HTML report) are written to `test-results/`.
