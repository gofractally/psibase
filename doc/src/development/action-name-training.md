# Action-name training: agent instructions and release checklist

Status: implemented development tooling and native codec integration, 2026-11-23. Read the [format specification](../specifications/data-formats/action-names.md) before changing training. C++, Rust and JavaScript now use the same new codec throughout the method/event/reflected-name paths. Existing encoded IDs need no compatibility support.

## Saved training bundle

The saved repository development bundle is `experiments/method-names/action-name-training/`. It preserves:

- `inputs/training.jsonl`: every exact input spelling and its binary-exact hexadecimal floating weight; 25,128 base spellings. Runtime codecs consume exported integer tables, not these floating weights.
- `inputs/evaluation.json`: frozen core names, descriptive probes, novel external names, provider/source grouping and source metadata.
- `inputs/provenance.json` and `inputs/policy.json`: corpus/split/source identities and cumulative update limits.
- Immutable `revisions/<hash>/`: weight ledger, full integer model, metrics, readable gains/losses, numeric ID changes, all evaluation goldens and a hash manifest linking its parent.
- `baseline.json` and `current.json`: the immutable root and current accepted development revision. Original source corpus and licenses remain alongside the bundle under `experiments/method-names/`.

The model exports complete CDFs, Q24 costs and deterministic tie rules. The reference implements the three readable modes, hash fallback, strict literals and bounded validation. The saved goldens use decimal strings for u64 values to avoid JavaScript precision loss. Existing research comparisons remain saved. Earlier development generations are archived under `history/pre-implementation-training`; the active bundle records the final trainer sources and current core declarations.

The current development update adds the four known core misses at one average vote each. It improves current-name coverage from 517/521 to 519/521, retains 17/21 descriptive probes and changes the external balanced score from 82.74% to 82.72%. All inputs and both generations are saved. This updates research artifacts, not deployed services.

## Bounded update policy

The executable policy is in the saved inputs; the defaults are:

| Limit | Default |
| --- | ---: |
| New target's first weight | At most one average base-name vote |
| Increase per accepted step | At most 2× its previous multiplier |
| Absolute per-name multiplier | 10× the fixed base-name average |
| Total targeted fraction | At most 0.25% of total training mass |
| Targeted spellings | At most 32 |
| Lost readable core/descriptive names | Zero, relative to both root and previous accepted generation |
| External balanced score drop | At most 0.25 percentage points from the fixed root |
| Any external ecosystem score drop | At most 1 percentage point from the fixed root |
| External formerly readable names lost | At most 0.5% of the external test population from the fixed root |

Cumulative limits always use the immutable baseline. Repeated small updates cannot evade them. All original source-relative weights remain fixed; targeted votes are additive. Training on frozen external or descriptive validation names is rejected. To introduce such a name as actual core training data, create an explicit new baseline and evaluation split, retaining the old artifacts and recording the reason. Treat descriptive, complete API names as the naming goal; compatibility with old abbreviations is a separate metric.

Default gates intentionally reject some numerically modest updates. Raising all four target weights from 1 to 2 loses a protected descriptive probe and cannot be applied. The earlier 10× experiment fit all current names while losing two descriptive probes; the default policy rejects that tradeoff. Adjust individual targets and examine their full descriptive alternatives rather than repeatedly raising every weight. Do not silently relax policy or overwrite a baseline to make a report pass.

## Agent procedure for a development update

1. Run `python3 tools/action_names.py report` to identify current core hash fallbacks. Read the current generation, policy and source provenance. Verify the saved bundle before editing anything. Keep unrelated exchange and migration work untouched.
2. Identify desired public action spellings from actual core APIs. Keep complete words, digits and underscores. Explain each new spelling in the request reason. A repeated example is an explicit weight choice, not independent evidence.
3. Create a JSON request containing a nonempty `reason` and the complete desired `weights` ledger. A target multiplier is extra average-name votes, including when the spelling already exists in the external base. Omitting a previous target removes that extra weight; readability gates still apply. Canonically duplicate case variants are rejected.
4. Run `python3 tools/action_names.py update request.json` without `--apply`. Read gains, losses, per-ecosystem scores, protected-probe results, model hash, full ID changes and targeted mass. Check ID uniqueness within action, event and reflected-member scopes during port/build generation.
5. Run `python3 tools/action_names.py update request.json --apply` only if the policy passes; this also imports and regenerates all three runtime table modules and shared vectors. This updates the development bundle pointer and retains both generations. It does not deploy anything or preserve the numeric IDs of previous generations.
6. Verify generated outputs with `python3 tools/action_names.py check` and run `python3 tools/test_action_name_retuning.py`. Rebuild all bindings, dispatch constants, event IDs, reflected-name lookups and schemas together. Run conformance/integration/performance checks and initialize a fresh disposable development chain with regenerated seed data and fixtures. All generated clients and services use the same model hash.
7. Commit the inputs, new revision, model, goldens, reports and generated port outputs as one reviewable change. State coverage changes, all protected-name losses, ID churn, model bytes and measured runtime/binary/compile-time effects. Update estimates with actual diff counts.

From the repository root:

```sh
python3 experiments/method-names/action_name_training.py verify experiments/method-names/action-name-training
python3 experiments/method-names/action_name_training.py reproduce experiments/method-names/action-name-training
python3 experiments/method-names/action_name_training.py update experiments/method-names/action-name-training request.json
python3 experiments/method-names/action_name_training.py update experiments/method-names/action-name-training request.json --apply
python3 -m unittest discover -s experiments/method-names -p 'test_action_name*.py' -v
```

`verify` checks artifact/input hashes, ancestry, policy, actual goldens and recomputed metrics. `reproduce` additionally rebuilds the model from saved training weights and requires an exact canonical model hash match. Trainer source changes require a reviewed new baseline bundle; preserve earlier bundles. `bootstrap <new-directory>` materializes the currently pinned external corpus into a new development baseline. It performs no network refresh. Refreshing collectors, changing the split or changing format rules is separate work with its own comparison report.

Only one writer operates on a bundle. Rejected candidates are retained for diagnosis but never promoted by `--apply`; manually repointing the bundle to one also fails verification. Hashes detect unintentional changes and bind release evidence. They do not replace repository access control or independently running CI.

## Native port implementation checklist

- [x] Replace the current method codec centrally and expose `ActionName`, strict parsers and exact u64 serialization in all three languages. Account names continue using the independent account encoder. A source-only `MethodNumber` alias, if useful during renaming, uses the new codec exclusively.
- [x] Generate the same model tables and costs from one canonical artifact. Embed its format/model hash; native builds depend on the generated inputs.
- [x] Implement all four modes, integer segmentation ties, exact range-coder termination, strict canonical re-encoding and bounded decoding. No runtime floating point.
- [x] Run shared goldens in Rust, C++ and JavaScript, including Node and browser JS. Test invalid identifiers, malformed literals, every mode boundary, overflow, maximum length, EOS and full hash vectors.
- [x] Reject duplicate numeric IDs within action, event and reflected-member scopes at build time. Test the diagnostic, rather than relying on Rust if/else ordering.
- [x] Keep ordinary generated dispatch numeric. Confirm services which only dispatch do not accidentally include the full decoder/trie tables.
- [x] Switch action/event schema identity and C++ reflected-name hashing to the same new codec. Keep numeric field indexes and account encoding independent. Regenerate affected expected IDs and fixtures.
- [x] Replace the old method encoder/tables in `programs/psinode/tests/name.py` and refresh its method tests from shared goldens. Keep its separate account helper and account tests.
- [x] Replace typed numeric→debug-text→numeric Transact transport centrally; test hook/permission checks, dynamic text clients and generated clients across both native languages.
- [ ] Check build-wide model-hash agreement and fail mismatched generated artifacts. Rebuild permissions, schemas, seed actions and transaction fixtures with the new IDs. Initialize and exercise a fresh disposable development chain; the codebase uses one active codec with no per-service format selection.
- [ ] Measure encoder/decoder time distributions, maximum input work, native/WASM bytes and compile time. Dispatch remains u64 comparison; make performance claims only from native measurements.

## Release lock checklist

- [ ] Select and document the final format/version, canonicalization, hash domain/byte order, strict literal grammar and model hash.
- [ ] Freeze corpus provenance/licenses, exact weighted spellings, split, policy, integer tables, costs, goldens and generator sources. Run `verify` and `reproduce` from a clean checkout.
- [ ] Run actual C++, Rust and JavaScript conformance jobs on the exact model and full golden corpus. Record raw machine-readable CI reports; passing Python or mocked unit fixtures do not satisfy this item.
- [ ] Complete all native port, direct-replacement integration and performance items above. Document fallback cases and collision checks.
- [ ] Confirm the old method encoder, old-ID expectations and compatibility branches are absent from active code paths. Check clean bootstrap, replay and snapshot scenarios using the final single codec. Historical research artifacts may remain as evidence.
- [ ] Write the release evidence and invoke `freeze`. Commit the lock and preserved report files with the release. CI reruns verification and refuses changed released model/table bytes.
- [ ] After release, leave these tables fixed. New names use the shipped model. Post-release format changes are separate work; development weight updates never reopen the shipping lock.

`freeze <bundle> <conformance.json>` requires exact revision/model identity, three language-specific report files with matching hashes, model/golden identities, full vector counts, and passing malformed/boundary/hash/round-trip/duplicate-ID checks. It copies the reports into the bundle and writes `release.lock`; every update then fails. Reports are CI attestations and must come from independently executed native tests. All three native implementations and their conformance tools exist. The development bundle remains deliberately unlocked for the final optimization pass; release evidence must be from the exact final shipping model.

The evidence format is:

```json
{
  "revision": "<64 hex revision>",
  "model_sha256": "<64 hex model>",
  "release_checklist_complete": true,
  "languages": {
    "cpp": {"passed": true, "report_path": "cpp.json", "report_sha256": "<64 hex>"},
    "rust": {"passed": true, "report_path": "rust.json", "report_sha256": "<64 hex>"},
    "javascript": {"passed": true, "report_path": "javascript.json", "report_sha256": "<64 hex>"}
  }
}
```

Each report contains `language`, `passed`, `model_sha256`, `golden_sha256`, an integer `vector_count`, and true `checks` for `malformed`, `boundaries`, `hash_fallback`, `round_trip` and `duplicate_ids`. Relative report paths resolve next to the evidence file. Preserve original CI logs/artifacts as well; a manually authored JSON claim is not a conformance run.
