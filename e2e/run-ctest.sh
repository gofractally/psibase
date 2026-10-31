#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

set +e
yarn node --input-type=module -e "
import { chromium } from '@playwright/test';
import { existsSync } from 'node:fs';
if (!existsSync(chromium.executablePath())) process.exit(77);
"
code=$?
set -e

if [ "$code" -eq 77 ]; then
    echo "Playwright Chromium not installed; skipping (run: yarn exec playwright install chromium)" >&2
    exit 77
fi
if [ "$code" -ne 0 ]; then
    exit "$code"
fi

exec env CI=1 yarn test
