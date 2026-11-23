# Eight-byte method-name encoding review

Review date: 2026-11-22. This is a research experiment and code audit. It does
not replace a production codec, change account addresses, deploy services, or
modify the separate migration checkout.

## Result

The [expanded corpus and balanced evaluation](EXPANDED-CORPUS.md) extend this
original experiment with C++ STL/Boost/Qt, Rust libraries, additional blockchain
RPCs and independent company SDKs. That follow-up compares training profiles on
the same test names and holds out whole ecosystems/providers. The numerical
tables below retain the original 22,480-declaration experiment for reproducibility.

A [targeted-training follow-up](TARGETED-TRAINING.md) adds the four remaining
Psibase misses at explicit weights and measures current-name coverage alongside
external holdouts and descriptive naming probes.

The [implemented action-name specification](../../doc/src/specifications/data-formats/action-names.md)
and [agent training/release checklist](../../doc/src/development/action-name-training.md)
now describe the active C++/Rust/JavaScript replacement. Use `tools/action_names.py`
from the repository root to report misses, update weights, import verified models,
and regenerate every port. `tools/test_action_name_retuning.py` checks two distinct
models without changing runtime consumer source. The original experiment tables
below are historical research; their old-codec probes refer to the pre-replacement
code and are not the current build/conformance workflow.

Keep numeric dispatch and improve the reversible name representation. A
method-trained context model plus a shared word dictionary and a short-name
literal mode is promising without discarding semantic characters. Look-alike
folding has little measured benefit in this corpus. Blind vowel deletion creates
real signed/unsigned API ambiguities.

Correctness and ABI transport need attention before retraining the production
model. Actual C++/Rust probes expose both cross-language disagreement and
unintended same-language collisions in the current implementation.

## Goals and information limit

The four operational goals are compatible for many common names:

1. Dispatch remains a comparison on a service-scoped `u64`.
2. Common method IDs can be decoded into recognizable text without fetching
   an action/argument schema.
3. Names which do not fit use a tagged hash fallback.
4. The on-wire method field stays eight bytes.

The statistical model and any dictionary are globally specified codec data,
not a per-application ABI schema. They must be available to the decoder and
versioned with the format.

No finite `u64` namespace can encode every arbitrarily long distinct string
without collisions. Statistical compression chooses which strings receive
reversible codes. Normalization deliberately identifies some spellings. Hashing
makes the remaining risk small rather than mathematically impossible. Distinct
IDs must be checked within a service's action domain, not across all services:
`serviceA::get` and `serviceB::get` may naturally share a method ID.

## Naming quality is the primary target

Existing Psibase method names were selected under pressure from this encoder.
They are a censored compatibility sample, not an unbiased description of how
maintainers would like to name new methods. A high success rate on `regEvIdx`
does not establish success on `registerEventIndex`.

The primary profile therefore trains on external APIs only and evaluates
unmodified external names, with explicit length bands. Psibase names measure
compatibility; they are not the shipping objective. A separate mixed profile
is diagnostic and must not be used to justify preserving short legacy styles.

[preferred-names.json](preferred-names.json) freezes 21 plausible descriptive
spellings as additional held-out probes. They are excluded from every training
profile, even if an exact name occurs in the external corpus. This small curated
set is not a representative statistical test and is not an ABI rename proposal;
it prevents a local-only percentage from concealing the maintainers' actual
readability goal. The probes informed architecture selection; they are held out
from parameter training, not an independent blind validation set. Examples include `registerEventIndex`,
`setAuthenticationService`, and `cancelPendingTokenTransfer`.

## Current code

### Accounts and methods now use different encoders

In this checkout, account names no longer use the historical trained arithmetic
model. They use an order-preserving enumerative encoding of up to ten characters,
with the primary-account rank in the high 56 bits and subaccount in the low 8 bits:

- `libraries/psibase/common/include/psibase/name.hpp`
- `libraries/psibase/common/include/psibase/NameEncoder.hpp`
- `rust/psibase_names/src/account_number.rs`
- `doc/src/specifications/data-formats/account-numbers.md`

Methods still use the same arithmetic table in C++ and Rust: EOS plus 26 letters,
27 previous-symbol contexts, 756 cumulative boundaries, frequency totals 32767
and a 17-bit arithmetic state. The model depends on only the previous symbol.
The tables match; their trainer and training provenance were not found.

- `libraries/psio/include/psio/compress_name.hpp`
- `rust/psibase_names/src/constants.rs`
- `rust/psibase_names/src/method_to_number_converter.rs`

The user's historical Reddit-training account explains the motivation, but it
must not be assumed to describe the current account implementation or establish
the provenance of the remaining method table.

### Current normalization is already lossy

For names which take the arithmetic path:

```text
uppercase -> lowercase
0123456789 -> eaiotnrslc
_ -> q
```

For example, `foo_bar` and `fooqbar` are the same numeric name; `foo_bar` and
`foobar` are not. Documentation saying underscores are dropped is inaccurate.
Ordinary punctuation such as hyphen/dot/colon and Unicode returns zero rather
than a general hash fallback. The documented initial-letter restriction is not
enforced by these raw functions.

Fallback hashes the original spelling rather than this canonical form. Thus
long mixed-case variants can have different hashed IDs even though short
mixed-case variants alias. Existing tests pin that distinction. It cannot be
changed silently as a cosmetic normalization fix.

Hash mode is selected by physical bit 56, not the documented bit 48. It leaves
63 effective hash bits. The explicit `#...` parser also needs stricter alphabet,
length, tag and exact-round-trip validation. The C++ and Rust parsers disagree
on some malformed hash literals.

### Two independently reproduced correctness defects

**Zero-probability transitions.** Fourteen non-EOS transitions have zero width:

```text
sx cx cj hx dx gx bx fx kx zx xx jc jg jx
```

The encoders check the total frequency rather than the chosen interval width.
They can produce a different readable name instead of falling back.

| Distinct input names | Shared current ID | Decoded label |
| --- | ---: | --- |
| `sx`, `szziat` | 2160093546 | `szziat` |
| `cx`, `czpe` | 4260478 | `czpe` |
| `hx`, `hzbmnslpamot` | 8508814 | `hzbmnslpamot` |
| `dx`, `dzbt` | 2160093595 | `dzbt` |

These are unintended letters-only collisions, not deliberate case/digit aliases.
The existing `Transact::regEvIdx` contains `dx`: both codecs display its actual
ID 18208626143935314 as `regevidzts`. That label re-encodes to the same ID.

**Finalization overflow.** C++ can discard terminal bits without invalidating
an already accumulated output. Rust explicitly invalidates that case and hashes:

| Input | C++ | Rust |
| --- | --- | --- |
| `requestRecovery` | 16891315777166274386, decoded `requestrecoverm` | 377020714223858314, decoded `#uliyrtecsnishone` |

In the local 528-name action/reflection sample, C++ gives 9 wrong readable labels;
Rust gives 1. C++ ID->text->ID changes the number in 8 cases. These counts describe
this source sample, not runtime traffic. The benchmark found no pair of
simultaneously declared names colliding within the sampled exact declaration
scopes; the counterexamples above still prove a correctness defect.

C++ reflection's generated switch catches duplicate case IDs in one scope.
Rust's generated dispatch uses if/else comparisons; a corresponding explicit
collision rejection was not found. Both language pipelines should reject
ambiguous declared action IDs before deployment.

## How much code relies on runtime string conversion?

The reproducible inventory is [usage-audit.json](usage-audit.json), generated by
[usage_audit.py](usage_audit.py). These are static source sites, not frequency
measurements.

| Native Rust package entry pattern | Sites | Files | Detail |
| --- | ---: | ---: | --- |
| Manual `add_action_to_transaction(...)` | 88 | 25 | 69 generated `ACTION_NAME` references, 16 literal names, 3 runtime/wrapper expressions |
| Typed `.add_to_tx(...)` or `::add_to_tx(...)` | 110 | 9 | Generated numeric callers still cross a string boundary |
| Union of affected files | | 34 | Counts are not additive execution samples |

Only 19 of the 88 manual sites lack generated action-name constants. Nevertheless,
all 88 use the string-taking native interface. Typed callers also lose their
numeric advantage:

```text
compile-time numeric method
  -> rust/psibase_plugin/src/wasm/transact.rs: method.to_string()
  -> string-only Transact WIT
  -> packages/system/Transact/plugin/transact/src/lib.rs:
     MethodNumber::from(action.method.as_str())
```

The runtime string entry points also include CLI/package action JSON, generic
MethodNumber JSON/GraphQL/schema serialization and event SQL names. Argument
schemas do not eliminate that method-name conversion, and rawData actions can
lack an argument schema entirely.

Supervisor's client-side JS/WIT export-method strings are a separate dispatch
mechanism; they must not be counted as on-chain MethodNumber encoding merely
because they are called methods.

A related spelling boundary exists in the current AuthSig sender hook: it
compares a raw camelCase action string, whereas a typed numeric wrapper's debug
round-trip supplies lowercase for a readable method. The current manual call
works; changing that caller to the typed wrapper needs numeric hook comparison.
Invite's numeric comparison is the more robust pattern.

## Corpus and evaluation

[corpus-metadata.json](corpus-metadata.json) records pinned revisions, file/archive
hashes, licenses, extraction rules and limitations. [corpus.py](corpus.py)
reproduces the source data. Downloaded code is never executed.

| Primary source | Identifier occurrences | Unique spellings | Kind |
| --- | ---: | ---: | --- |
| [Google APIs](https://github.com/googleapis/googleapis) | 15,211 | 6,686 | Protobuf RPC methods |
| [Ethereum execution APIs](https://github.com/ethereum/execution-apis) | 93 | 93 | JSON-RPC methods |
| [Kubernetes](https://github.com/kubernetes/kubernetes) | 1,175 | 1,175 | Generated OpenAPI operationIds |
| [Microsoft DOM generator](https://github.com/microsoft/TypeScript-DOM-lib-generator) | 4,830 | 1,153 | DOM/WebGL/interface methods |
| [TypeScript v5.9.3](https://github.com/microsoft/TypeScript/tree/v5.9.3/src/lib) | 929 | 306 | ECMAScript interface methods |
| [CCXT](https://github.com/ccxt/ccxt) | 208 | 208 | Unified exchange capability methods |
| [ethers](https://github.com/ethers-io/ethers.js) | 34 | 31 | Provider/Signer public interfaces |
| **External total** | **22,480** | | Unique spellings can overlap sources |

The experiment also extracts 528 distinct local Rust action/C++ reflected method
names. These include reflection/query methods as well as actions; they are not
528 independent deployed blockchain endpoints.

Google versions are grouped by service family. Mixed-source splits are grouped
by service/interface family. Names are deduplicated for training. A novel-name
test removes every exact lowercase name already seen anywhere in training.
OpenAPI operationIds are intentionally a long-name stress set, not representative
short source-method names. DOM data supplies actual abbreviated/numeric names
such as `uniformMatrix4x3fv`, `getUint32`, `btoa` and `imul`.

### Prototype formats

[benchmark.py](benchmark.py) contains an independent experimental arithmetic
coder with explicit EOS, positive quantized frequencies,32-bit range state and
asserted full decode/re-encode round trips. It preserves digits and underscores,
except in explicitly labeled lossy candidates.

Single models use a 1-bit format reservation and 63 readable payload bits.
Mixtures use 2 mode bits and 62 payload bits. The three readable modes are:

1. A trained two-character-context arithmetic model.
2. A global component-word dictionary with arithmetic-coded tokens, or the alternative trained 512-token subword model.
3. A bijective base 37 literal representation for short unusual names.

The remaining mode is available for hash fallback. The experiment implements
and validates the readable branches; it reports overflow rather than claiming
to have finished the production fallback/parser/compatibility specification.
These are NEW incompatible representations, not proposed edits to an existing
production probability table in place.

The component dictionary learns word spellings from actual CamelCase/snake_case
API declarations. The encoder can find their lowest-cost segmentation in plain
lowercase text; decoding restores the full lowercase name. The benchmark tests
1,024 and 2,048-token dictionaries, with 1,024/2,048 as approximate vocabulary
budgets rather than promises about production memory layout.

The dictionary is global codec data, not a service-specific schema. A method
such as a familiar prefix+resource+operation can be encoded in a few tokens and
expanded back into the full canonical name. The literal branch protects short
abbreviations which an API-trained probability model did not predict.

### Measured coverage

Here **readable** means the entire lowercase name is recovered. Wrong readable
outputs from the old C++ codec are counted as failures. Current baseline digit
and underscore aliases are accepted as its legacy canonical form; the exact
new prototypes preserve those distinctions, which is a stricter requirement.

#### Original corpus: external APIs only, with service-family holdouts

| Dataset | Names | Current C++ correct-readable | Exact char2 | Exact words/context/literal |
| --- | ---: | ---: | ---: | ---: |
| Unseen Google RPC names | 1,137 | 28.41% | 74.93% | 89.36% |
| Unseen DOM names | 204 | 49.51% | 72.06% | 91.18% |
| Unseen ECMAScript names | 37 | 100.00% | 100.00% | 100.00% |
| Descriptive design probes | 21 | 4.76% | 38.10% | 71.43% |
| Existing Psibase: compatibility only | 528 | 89.58% | 91.10% | 96.97% |

#### Generalization: Google-only training; other projects entirely held out

| Dataset | Names | Current C++ correct-readable | Exact char2 | Exact words/context/literal |
| --- | ---: | ---: | ---: | ---: |
| google_novel_holdout | 1,140 | 28.60% | 76.67% | 89.56% |
| preferred_descriptive_probes | 21 | 4.76% | 28.57% | 42.86% |
| psibase | 528 | 89.58% | 87.69% | 95.08% |
| typescript-dom | 1,153 | 59.93% | 73.37% | 78.23% |
| ccxt | 208 | 27.88% | 50.48% | 56.25% |
| ethers | 31 | 70.97% | 83.87% | 93.55% |
| ethereum | 93 | 15.05% | 8.60% | 19.35% |
| kubernetes | 1,175 | 0.26% | 1.19% | 2.30% |

#### Secondary diagnostic: mixed training, novel names in held-out families

| Dataset | Names | Current C++ correct-readable | Exact char2 | Exact words/context/literal |
| --- | ---: | ---: | ---: | ---: |
| google_novel_holdout | 1,136 | 28.35% | 75.26% | 89.70% |
| preferred_descriptive_probes | 21 | 4.76% | 38.10% | 66.67% |
| psibase_novel | 42 | 92.86% | 97.62% | 97.62% |
| typescript-dom_novel | 204 | 49.51% | 72.55% | 92.16% |
| kubernetes_novel | 654 | 0.31% | 5.20% | 11.16% |

The Google-only training profile holds out every Psibase/DOM/Ethereum/Kubernetes
name as an external project, not just a random 20% of their methods. It shows why
training only on a large RPC style is insufficient for unusual abbreviations.
The mixed profile has unseen service families and unseen exact names, but is
not a wholly unseen-project test. Its 42-name novel Psibase subset is small;
the observed success rate there is preliminary evidence, not a general success guarantee. The hash
split happened to place all six Ethereum namespaces in mixed training, so use
the 93-name whole-project Google-only test for Ethereum generalization.

The total prototype gain includes improved termination, arithmetic precision,
normalization and model selection. It must not all be attributed to retraining.
A controlled pair uses the same new coder/legacy alphabet with the old table
versus the new first-order table; it isolates the benefit of the learned model
more closely. Within the exact new alphabet, char1 versus char2 isolates context
order. All candidate/control results and length-band breakdowns are in
[results-external.json](results-external.json), [results-google.json](results-google.json)
and [results-mixed.json](results-mixed.json).

The external-only dictionary/context mixture recovers, for example,
`registerEventIndex` using 34 payload bits, `setAuthenticationService` using 30,
and `cancelPendingTokenTransfer` using 47, plus their two mode bits. Their wire
fields still occupy eight bytes. No spelling was shortened to obtain those
results. Longer misses, such as `withdrawMarketLiquidity`, remain misses; they
must not be treated as instructions to abbreviate the API.

The design probes also expose format overhead: a 32-character name such as
`createAccountWithRecoveryPartner` needs 63 bits with the standalone word model
but does not fit its 62-bit branch in the flat-tagged mixture. A variable-prefix
mode allocation is a legitimate future candidate; it has not been benchmarked
here. Broader vocabulary, conditional token models and character escapes are
other candidates. A frozen independent validation corpus is needed before
selecting a production format.

CDF cache sizes are diagnostic counts of evaluated contexts, not deployment
model sizes. Python runtime includes training, IPC and evaluation overhead; it
is not a C++/Rust codec or u64 dispatch benchmark. The prototype's word
segmentation uses Python floating-point costs; production would require frozen
integer cost tables and deterministic tie-breaking with cross-language golden
vectors. No dispatch-speed gain is claimed from these coverage results.

## Fuzzy names and collisions

Folding `o/0` and `l/1` reduces the alphabet and may improve readability of chosen
aliases, but it makes those strings the same canonical identity. It does not
reduce collisions between distinct accepted names. It can be a naming rule only
if that equivalence is intentional and duplicate declarations are rejected.
The tested look-alike transform maps `o->0`, `l->1`; it found no coexisting
within-scope pairs in this finite corpus. That is not a proof for future names.
Its coverage gain over the same first-order exact model was small.

Removing vowels saves much more, but the corpus contains 12 within-interface
potential collision groups, including:

```text
DataView.getInt8 / DataView.getUint8       -> gtnt8
DataView.setInt32 / DataView.setUint32     -> stnt32
BigInt.asIntN / BigInt.asUintN             -> asntn
WebGL clearBufferiv / clearBufferuiv      -> clrbffrv
```

The `u` is a type distinction, not expendable decoration. Such a transformation
would need a retained discriminator or an explicit rejection/alias contract.
The JSON reports distinguish potential normalization equivalences from actual
current numeric collisions; hash fallback currently preserves some original
spelling distinctions, so the two measurements must not be conflated.

A future fuzzy-debug format could allocate some bits to a compressed readable
label and the rest to a fingerprint of the full canonical name. That trades
readable capacity against fingerprint strength. Its decoder must show a stable
numeric literal/fingerprint alongside the fuzzy label: the label alone is
insufficient for ID->text->ID. Compiler/registration checks still have to reject
actual per-service collisions. This path is worth a separate experiment if the
lossless mixture does not meet the target; it is not necessary to obtain the
measured lossless improvements above.

## Recommended engineering sequence

Current adoption scope is a direct pre-release replacement, per the user's
2026-11-23 direction. Existing method/event IDs and development fixtures do not
need compatibility. The old-codec measurements above remain research evidence.

1. Define strict canonicalization and exact validation. Golden/property tests
   must cover zero-width transitions, EOS/finalization exhaustion, reserved-bit
   handling, case, digits, underscore, bad hash literals and all supported
   languages. Every readable output must round-trip completely; no silent
   truncation is acceptable. Emit duplicate-ID errors for action, event and
   reflected-member declarations within their lookup scopes.
2. Carry a generated numeric method ID across the native Transact interface.
   Preserve the string API for intentional dynamic clients, with a strict
   parser; do not turn numeric IDs into debug strings and parse them back.
   In JS/WIT, transport u64 as BigInt or an exact string, never a Number.
3. Evaluate a fixed global word/context/literal mixture before lossy
   folds. Fix one training set, splitting policy, smoothing/escape rules,
   dictionary, mode layout and bounded decoder, then generate identical tables
   and golden vectors for C++, Rust and JavaScript. Compile-time callers need not run the
   statistical encoder during dispatch.
4. Specify the fallback hash and canonical input before deployment. The
   current SeaHash is explicitly non-cryptographic in its
   [own documentation](https://docs.rs/seahash/4.1.0/seahash/). A versioned
   collision-resistant digest truncated into its reserved payload is one
   candidate; neither that nor SeaHash removes the need for duplicate-ID checks.
5. Replace the method encoder centrally. Actions, events and reflected-name
   lookups use the same new codec. Replace the Python node-test encoder copy;
   regenerate bindings, schemas, permission/seed IDs and expected test values.
   Build all components against one model hash and initialize a fresh disposable
   development chain. Account names retain their separate account encoder.
   There is no old decoder, dual dispatch, per-service codec selection or
   historical-ID migration. Freeze the complete model at shipping using the
   saved training/release workflow.

Changing the probability model does not change the on-chain u64 comparison.
Its main value is more readable names and less fallback. Removing avoidable
runtime recoding is a separate direct improvement to the client/API path.

## Reproduction

From the repository root:

```sh
python3 experiments/method-names/corpus.py
mkdir -p build-method-names
c++ -std=c++23 -O2 -I libraries/psio/include experiments/method-names/codec_probe.cpp -o build-method-names/codec-probe-cpp
cargo build --offline --release --manifest-path experiments/method-names/codec-probe/Cargo.toml --target-dir build-method-names/rust
python3 experiments/method-names/usage_audit.py
python3 experiments/method-names/benchmark.py --output experiments/method-names/results-google.json
python3 experiments/method-names/benchmark.py --training external --output experiments/method-names/results-external.json
python3 experiments/method-names/benchmark.py --training mixed --output experiments/method-names/results-mixed.json
```

The collector uses pinned revisions on rerun and records source hashes. Build
outputs and downloaded archives stay under `build-method-names`. License copies
for the identifier sources are in [licenses](licenses/).
