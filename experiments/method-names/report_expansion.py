#!/usr/bin/env python3
"""Render the expanded research report from validated result artifacts."""
from collections import defaultdict
import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
LABELS = {'cpp': 'C++ / STL / Boost / Qt', 'rust': 'Rust standard library and crates',
          'blockchain': 'Blockchain RPCs', 'service-api': 'Commercial and service APIs',
          'javascript': 'JavaScript / web interfaces'}


def load(filename):
    return json.loads((HERE / filename).read_text())


def main():
    metadata = load('corpus-expanded-metadata.json')
    result = load('results-expanded.json')
    corpus_hash = hashlib.sha256((HERE / 'corpus-expanded.jsonl').read_bytes()).hexdigest()
    metadata_hash = hashlib.sha256((HERE / 'corpus-expanded-metadata.json').read_bytes()).hexdigest()
    def validate(row):
        assert row['corpus_sha256'] == corpus_hash == metadata['sha256']
        assert row['corpus_metadata_sha256'] == metadata_hash
        for path, expected in row['experiment_source_sha256'].items():
            assert hashlib.sha256((HERE / path).read_bytes()).hexdigest() == expected, path
    validate(result)
    records = [json.loads(line) for line in (HERE / 'corpus-expanded.jsonl').read_text().splitlines()]
    by_ecosystem = defaultdict(list)
    for row in records:
        by_ecosystem[row['ecosystem']].append(row)
    rows = []
    for ecosystem, group in sorted(by_ecosystem.items()):
        rows.append(f"| {LABELS[ecosystem]} | {len(group):,} | {len({row['method'] for row in group}):,} | {len({row['source'] for row in group})} |")
    profiles = result['profiles']
    def macro(profile):
        return profiles[profile]['models']['mixture']['metrics']['macro']
    scores = []
    for ecosystem in sorted(by_ecosystem):
        values = [macro(profile)['ecosystem_macro_percent'][ecosystem]
                  for profile in ('historical_unique', 'expanded_unique', 'expanded_balanced')]
        scores.append(f"| {LABELS[ecosystem]} | " + ' | '.join(f'{value:.1f}%' for value in values) + ' |')
    scores.append('| **Balanced overall score** | ' + ' | '.join(
        f"**{macro(profile)['balanced_macro_percent']:.1f}%**" for profile in ('historical_unique', 'expanded_unique', 'expanded_balanced')) + ' |')
    holdouts = []
    for filename, label in [('results-expanded-no-cpp.json', 'All C++ sources'),
                            ('results-expanded-no-rust.json', 'All Rust sources'),
                            ('results-expanded-no-blockchain.json', 'All blockchain RPC sources'),
                            ('results-expanded-no-google.json', 'All Google API declarations')]:
        heldout = load(filename)
        validate(heldout)
        outcomes = heldout['profiles']['expanded_balanced']['models']['mixture']['metrics']
        holdouts.append(f"| {label} | {heldout['split']['novel_names']:,} | {outcomes['macro']['balanced_macro_percent']:.1f}% |")
    probe_counts = [profiles[profile]['models']['mixture']['metrics']['preferred_descriptive_probes']['readable']
                    for profile in ('historical_unique', 'expanded_unique', 'expanded_balanced')]
    google_mass = result['balance']['source_mass']['googleapis']['mass'] * 100
    text = f'''# Expanded method-name corpus and balanced evaluation

Review date: 2026-11-22. This extends the [original review](README.md) without changing a production codec or the separate migration checkout.

## What changed

The corpus grew from 22,480 declarations to **{metadata['records']:,} declarations, {metadata['unique_spellings']:,} distinct spellings, and {metadata['unique_lowercase']:,} distinct lowercase spellings across {len(metadata['sources'])} source groups**. Counts describe extracted API declarations, not runtime calls or a census of every reachable public export. Repeated names across families remain visible as declarations but do not acquire extra training votes within a source.

| Ecosystem | Declarations | Distinct spellings within ecosystem | Source groups |
| --- | ---: | ---: | ---: |
{chr(10).join(rows)}

Distinct-spelling columns overlap across ecosystems and must not be summed.

New sources include LLVM libc++ standard-library synopses; Boost Asio, Beast, Container, MultiIndex, Filesystem, JSON, URL, Unordered, Algorithm and Math; Qt Core and Network; Rust std/core/alloc, Tokio, futures, serde, axum, reqwest, rayon, clap, regex, Diesel and Crossbeam; Bitcoin Core, Solana, Polkadot, Cosmos and CometBFT; and AWS, Stripe and GitHub/Octokit SDK declarations. The original Google, Ethereum, Kubernetes, DOM, ECMAScript, CCXT and ethers samples remain available.

All upstream inputs are pinned to immutable commits, with source/license hashes and extraction rules in the [expanded metadata](corpus-expanded-metadata.json) and linked shard metadata. Historical releases are intentional source samples where applicable. Downloaded corpus source is parsed as data rather than built or executed. C++ and Rust use declaration parsers; wire APIs use explicit RPC registrations, mappings or service declarations. Macro expansion and semantic export resolution are outside these extractors. The Rust shard explicitly records two rejected core files. C++ scope-recovery guards conservatively reject ambiguous declarations; parser statistics and limitations are recorded in its metadata.

## Correcting the concentration bias

The three profiles use the same codec architecture and evaluation names:

1. **Original data:** train the prototype on the original external corpus.
2. **Expanded data:** train it on distinct spellings from the expanded corpus.
3. **Expanded balanced:** give equal mass to ecosystems, then providers within each ecosystem, sources within each provider, and distinct spellings within each source.

The balanced profile gives Google **{google_mass:.1f}%** of total training mass. Boost's many modules share one provider allocation. Overloads, repeated versions and repeated declarations within a source add no weight. This is an explicit diversity objective, not an estimate of real-world method-call frequency.

Psibase names measure compatibility only and are excluded from training. The 21 preferred descriptive names are also excluded from every profile. Service families use the original deterministic hash split. Every exact lowercase spelling present anywhere in the expanded training set is removed from all profiles' novel tests, making their evaluation set identical.

## Results on the same unseen names

These percentages measure complete lowercase recovery in the experimental eight-byte word/context/literal mixture, preserving digits and underscores. All three columns use that same prototype; the first column is not the current production codec. Ecosystem scores average sources within providers, then providers within ecosystems. The overall score gives each ecosystem equal weight. It is a chosen macro-average rather than a pooled success rate over declarations.

The common novel evaluation contains **{result['split']['novel_names']:,} distinct spellings**, with detailed per-source counts and length bands in [results-expanded.json](results-expanded.json).

| Novel evaluation ecosystem | Original data | Expanded data | Expanded balanced |
| --- | ---: | ---: | ---: |
{chr(10).join(scores)}

On the 21 descriptive design probes, those profiles recover **{probe_counts[0]}/21, {probe_counts[1]}/21, and {probe_counts[2]}/21**, respectively. These are curated probes that informed the earlier architecture, not a blind validation set. The broadened external holdouts are the more useful check of naming diversity. Training balance involves tradeoffs; per-source and length-band results should guide subsequent format choices rather than one aggregate percentage.

## Whole-ecosystem and provider holdouts

Additional runs remove an entire ecosystem or provider from training and test its novel spellings. They use expanded balanced training on the remaining sources. Exact lowercase overlap with the remaining training sources is still removed. Each row has a different evaluation population, so these percentages must not be compared directly with each other or the family-holdout table above. Single-family Solana and CometBFT APIs are covered by the blockchain holdout even when they have no family holdout in the main split.

| Entire source category excluded from training | Novel spellings tested | Balanced readable score |
| --- | ---: | ---: |
{chr(10).join(holdouts)}

The five result files record corpus, metadata, experiment-source and current-codec source hashes. The experiment still implements only readable branches; hash fallback and production migration are separate work. All successful encodings are checked for full decode, re-encode stability and unintended numeric collisions among evaluated canonical names. Python execution times are experiment overhead and provide no dispatch-speed measurement.

## Reproduction and validation

From the repository root, collect the shards, merge, then evaluate:

```sh
python3 experiments/method-names/corpus.py
python3 experiments/method-names/corpus_cpp.py
python3 experiments/method-names/corpus_rust.py
python3 experiments/method-names/corpus_apis.py
python3 experiments/method-names/expand_corpus.py
python3 experiments/method-names/expansion_benchmark.py
python3 experiments/method-names/expansion_benchmark.py --leave-out-ecosystem cpp --output experiments/method-names/results-expanded-no-cpp.json
python3 experiments/method-names/expansion_benchmark.py --leave-out-ecosystem rust --output experiments/method-names/results-expanded-no-rust.json
python3 experiments/method-names/expansion_benchmark.py --leave-out-ecosystem blockchain --output experiments/method-names/results-expanded-no-blockchain.json
python3 experiments/method-names/expansion_benchmark.py --leave-out-provider google --output experiments/method-names/results-expanded-no-google.json
python3 -m unittest discover -s experiments/method-names -p test_expansion.py -v
python3 experiments/method-names/report_expansion.py
```

Build the two current-codec probes using the [original instructions](README.md#reproduction) before benchmarking. Collector dependencies, fixtures, pinned versions and caches are documented in their source and [Rust parser documentation](rust-declaration-parser/README.md). The weighting tests cover duplicate invariance, provider allocation, cross-project/case leakage, weighted round trips and preservation of the original unweighted probe results. Source parser fixtures and metadata checks cover declaration selection and provenance. The original corpus and original result artifacts remain unchanged.
'''
    (HERE / 'EXPANDED-CORPUS.md').write_text(text)
    print('Saved', HERE / 'EXPANDED-CORPUS.md')


if __name__ == '__main__':
    main()
