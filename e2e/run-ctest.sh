#!/usr/bin/env bash
# Usage: run-ctest.sh [browser] [extra playwright args...]
# browser: chromium (default) or webkit. Runs that Playwright project only.
# Exits 77 (CTest skip) when that browser isn't installed.
set -euo pipefail
cd "$(dirname "$0")"

browser="${1:-chromium}"
shift || true

set +e
E2E_BROWSER="$browser" yarn node --input-type=module -e "
import * as pw from '@playwright/test';
import { existsSync } from 'node:fs';
const b = pw[process.env.E2E_BROWSER];
if (!b) process.exit(2);
if (!existsSync(b.executablePath())) process.exit(77);
"
code=$?
set -e

if [ "$code" -eq 77 ]; then
    echo "Playwright $browser not installed; skipping (run: yarn exec playwright install $browser)" >&2
    exit 77
fi
if [ "$code" -ne 0 ]; then
    echo "Unknown or broken Playwright browser: $browser" >&2
    exit "$code"
fi

exec env CI=1 yarn test --project="$browser" --pass-with-no-tests "$@"
