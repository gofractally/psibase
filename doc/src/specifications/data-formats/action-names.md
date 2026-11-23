# Action names: proposed format and adoption

Status: implemented development format, 2026-11-23. Independent C++, Rust and JavaScript codecs now replace the old method-name encoding. The model remains unlocked for pre-release optimization; shipping freezes the complete model and format. Current tables and all runtime ports use one model fingerprint.

## Purpose and type boundary

The shared method-name encoder uses the new format and exposes the logical `action_name` type alongside account names. Its field occupies eight bytes and dispatch compares a `u64`. Its decoder recovers complete canonical names using one globally specified model, without an application-specific argument schema or dictionary.

Use the repository's type conventions: `psibase::ActionName` with an `action_name` alias in C++, `ActionName` in Rust, and a branded `ActionName` bigint in TypeScript. Existing `MethodNumber` source references may temporarily name the same new type through an alias, or be renamed mechanically. Such an alias uses only the new encoding; it does not retain an old decoder, old IDs or runtime selection.

Action names, event names and generic C++ reflected-name lookup all adopt the new shared codec. Account numbers use their independent account encoder. HTTP methods and Supervisor/WIT plugin-export names are separate string APIs and do not need numeric encoding. Numeric reflected-field indexes are separate from reflected-name hashes and keep their existing packing rules.

All ports expose strict, fallible text parsing, exact raw-u64 conversion, encode/decode and the same model fingerprint. Rust uses a transparent u64 wrapper; C++ asserts an eight-byte representation; JavaScript uses BigInt throughout. JSON represents raw numeric IDs as exact strings, while normal action JSON may retain canonical method text. JavaScript Number is unsuitable for a general u64.

## Draft wire contract

The complete reference is [action_name_model.py](../../../../experiments/method-names/action_name_model.py). Its development format identifier is `action-name-v1-draft`. The runtime implementations match its frozen rules and vectors. Finalize the release identifier before shipping lock.

Input is an ASCII identifier of 1 through 256 characters: `[A-Za-z_][A-Za-z_0-9]*`. Case folds to ASCII lowercase; digits and underscores remain distinct. An explicit hash literal is exactly `#` followed by sixteen lowercase hexadecimal digits encoding a mode-11 ID. Invalid strings return errors, never zero or partial text.

| Top two bits | Remaining 62 bits |
| --- | --- |
| `00` | Two-character-context arithmetic code |
| `01` | Component-word arithmetic code |
| `10` | Bijective base-37 literal |
| `11` | Hash fallback |

Select the shortest fitting readable payload, then lowest mode number, then lowest numeric payload as deterministic ties. The arithmetic coder has 32-bit range state, explicit EOS and positive frequencies totaling 32768. Termination bits count against the payload limit. Mode 10 uses the frozen alphabet `abcdefghijklmnopqrstuvwxyz0123456789_`. Zero, empty text, noncanonical padding and malformed readable IDs are rejected by the strict decoder. Every accepted readable ID must decode completely and re-encode to the same u64.

The frozen model contains all 1,407 reachable character-context CDF rows, up to 2,048 word symbols, their CDF and Q24 integer segmentation costs. Word segmentation minimizes `(integer cost, token count, token-ID sequence)`. Exported integer costs and CDFs are authoritative; runtime ports perform no statistical training, floating-point logarithms or platform-dependent quantization. Decode is bounded to 256 output characters. Freeze alphabet order, CDF layout, EOS, range-coder operations, literal arithmetic and tie rules in shared vectors.

For fallback, hash `b"psibase.action_name.v1\0" + canonical_ascii` with SHA-256. Interpret the first eight digest bytes as little-endian, retain the low 62 bits, then set mode `11`. Display it as the full-ID hash literal. A truncated hash cannot prove uniqueness over all possible strings: declaration generation must reject duplicate IDs within each action, event or reflected-member lookup scope before compiling or deploying. Hash results require exact cross-language vectors too.

## Development generations and shipping

Training may change while core libraries develop. Every candidate receives immutable inputs, weights, model bytes, metrics, golden vectors, an ID-change report and a model hash. The [agent workflow](../../development/action-name-training.md) defines the bounded updater and release checklist. A model update is an ABI generation change even when coverage barely moves. The tested one-vote update changed 4,518 evaluated IDs.

Generated bindings, macros, build outputs, pack/unpack endpoints and clients must agree on the single build/network generation. Embed its model hash and reject mismatched generated artifacts. Rebuild the core together and initialize a fresh disposable development chain when IDs change; regenerate seed data and fixtures. Compile/generated constants provide numeric dispatch; services which only dispatch should not link a full decoder dictionary and trie. Measure native/WASM code size and compile time as well as encoder/decoder CPU.

Shipping freezes the complete format and model, not only the weights. Preserve the corpus/license provenance, exact weighted spellings, split, integer tables, canonicalization, hash contract, goldens, build inputs and release evidence. New actions added after shipping use the same fixed model and fallback. Post-release format changes are outside this initial adoption plan.

## Implemented integration

- C++ uses `psio/action_name.hpp` and `psibase/ActionName.hpp`; Rust uses `psibase_names::action_name_*` and `psibase::ActionName`; JS/TS exports `@psibase/common-lib/action-name` for browser, Node ESM and CommonJS. All four encoding modes are independently implemented in each language.
- `MethodNumber` and `_m` remain source spellings for the same new codec. No old decoder, old numeric IDs or runtime format selection remain in active paths. C++ actions, events and reflected-name lookup share the new encoding; numeric reflection field indexes and the account encoder are independent.
- C++ reflection and Rust macros generate numeric dispatch constants and reject duplicate IDs within lookup scopes. Valid C++ dispatch uses those constants and does not decode names to construct an error message. Error-only formatting also avoids linking the full statistical decoder into dispatch-only services.
- Rust typed transaction callers use the new WIT `add-action-id-to-transaction(u64, ...)` entry point. The Transact plugin retains numeric identity and decodes once only where the string hook API needs it. Dynamic text inputs use the same strict parser. Invalid IDs produce errors before host calls.
- Schema custom types use `ActionName`; the Python node-test helper and byte-layout fixtures consume the shared model. Dynamic validators in Transact, Invite and Workshop handle parsing failures rather than relying on the old infallible parser.
- Native and actual WASM32 compile checks cover constexpr encoding and SHA-256 padding. The 32-bit padding length is explicitly converted to u64 before shifts up to 56 bits.

## Regeneration without consumer edits

The authoritative runtime model is `libraries/psibase/common/share/action-name-model.json`. Run these commands from the repository root:

```sh
python3 tools/action_names.py report
python3 tools/action_names.py update request.json
python3 tools/action_names.py update request.json --apply
python3 tools/action_names.py check
python3 tools/test_action_name_retuning.py
```

`report` lists current core hash fallbacks. An accepted `update --apply` imports the bounded training result and regenerates C++, Rust and TS tables plus the shared vectors. Existing callers, serializers and encoder implementation code do not change. `generate` regenerates from the already-selected model; `import-training --bundle <path>` promotes a verified saved bundle. Generated files are checked into source and CI fails stale output.

`tools/test_action_name_retuning.py` exercises two saved models against all three independently compiled ports, verifies the encoder source files are unchanged, and restores the active model in a `finally` block. The model remains development-unlocked until the release checklist is complete.

## Replacement scope

The user's pre-release requirement is authoritative: existing encoded IDs, staged transactions, event histories and encoded test fixtures do not require compatibility. Replace or regenerate these development artifacts together. Remove the old method codec and its old-ID expectations from active runtime/test paths. Historical experiments can remain as research evidence.

The high mode bits select four branches inside the new codec. There is no old/new format autodetection, service-specific codec negotiation, legacy decoder, dual dispatch, activation history, alias-permission migration or old-schema translation in this plan. A model hash coordinates builds and freezes the shipping artifact; it does not introduce a per-action version field.

Account names stay on their independently designed account encoder because they have a different naming domain. Keeping account-name semantics is a scope decision, not a legacy method-ID constraint. Numeric reflected-field numbering likewise remains independent from name hashing.

## Source impact and validation

The old C++ compressor, Rust probability tables/converters and Python node-test encoder are replaced. Generated model data and saved training history are reported separately from runtime source. Run `python3 tools/action_name_change_report.py --output build-action-names/change-report.json` after staging new files for the actual added/deleted line census; runtime Rust files can include inline tests.

The [handoff validation report](../../../../docs/action-names/VALIDATION.md) records current commands, model hashes, cross-language vectors, retuning, native/WASM tests, numeric transport and schema comparison coverage. Full package verification tests still use the repository's normal SDK/package build; the focused schema exporter compares real C++ interface schemas directly with Rust and does not fabricate executable packages.

Generated assets are intentionally separate from handwritten code: the JSON model is roughly 378 KB, and each port consumes generated integer tables and dictionary data. Services which only dispatch use generated numeric IDs. Account identifiers keep their independent encoding.
