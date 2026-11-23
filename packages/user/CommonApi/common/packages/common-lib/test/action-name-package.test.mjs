// Run after `yarn build`: validate the actual published import/require entries.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import * as esm from "@psibase/common-lib/action-name";

const require = createRequire(import.meta.url);
const cjs = require("@psibase/common-lib/action-name");
const repo = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../../../../../..",
);
const vectors = JSON.parse(
    await readFile(
        resolve(
            repo,
            "libraries/psibase/common/share/action-name-vectors.json",
        ),
        "utf8",
    ),
);

test("published ESM and CJS subpaths work in Node without browser globals", () => {
    for (const codec of [esm, cjs]) {
        assert.equal(codec.ACTION_NAME_MODEL_SHA256, vectors.model_sha256);
        for (const row of vectors.vectors) {
            const value = codec.encodeActionName(row.text);
            assert.equal(String(value), row.value_u64, row.text);
            assert.equal(codec.decodeActionName(value), row.decoded, row.text);
            assert.equal(
                codec.actionNameFromJSON(codec.actionNameToJSON(value)),
                value,
            );
        }
    }
});
