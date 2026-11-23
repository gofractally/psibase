# Psibase Common Lib

Common library that can be accessed at `[psibase-node-root-url]/common/common-lib.js`

## Action names

The library exports the shared action/event/reflected-name encoder as a pure
TypeScript implementation for browsers and Node. It uses exact `bigint` IDs,
frozen integer model tables, and the existing synchronous `hash.js` dependency.
It performs no network requests or WebAssembly calls.

```ts
import {
    encodeActionName,
    decodeActionName,
    actionNameToJSON,
    actionNameFromJSON,
    ACTION_NAME_MODEL_SHA256,
    type ActionName,
} from "@psibase/common-lib/action-name";

const id: ActionName = encodeActionName("registerEventIndex");
const canonicalName = decodeActionName(id); // "registereventindex"
const exactDecimalID = actionNameToJSON(id);
const restored = actionNameFromJSON(exactDecimalID);
```

Use the dedicated `/action-name` entry in Node and in small codec-only browser
bundles. The browser common-lib root also exports the same API.

Text encoding validates ASCII identifiers, folds case and retains digits and
underscores. Hash fallback decodes to an exact `#` plus sixteen lowercase hex
digits, which re-encodes to the same ID. Decoding rejects malformed or
noncanonical readable IDs. `actionNameFromRaw` accepts an opaque unsigned u64;
`decodeActionName` separately validates its format. Never convert an ID to a
JavaScript `number`.

`src/action-name-model.generated.ts` is generated centrally. To update the
model, use the repository's training workflow and `tools/action_names.py`; do
not edit the runtime or its callers. `python3 tools/action_names.py generate`
regenerates all language tables and shared vectors, and `check` verifies them.

From this package, `yarn test:action-name` checks every shared golden ID,
malformed input, bounded decode, exact JSON transport, randomized canonical
round trips and a browser-target bundle with no Node/Buffer/DOM globals.
After `yarn build`, `yarn test:action-name-package` checks the actual published
ESM and CommonJS subpaths against every shared golden without browser globals.
`yarn build:action-name-test` prepares the bulk probe; `yarn probe:action-name`
reads names from stdin and emits tab-separated input, decimal ID, decoded text
and hash flag. Pass `--decode` for decimal-ID input or `--model-hash` to print
the exact compiled model fingerprint.
