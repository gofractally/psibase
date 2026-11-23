# Expanded method-name corpus and balanced evaluation

Review date: 2026-11-22. This extends the [original review](README.md) without changing a production codec or the separate migration checkout.

## What changed

The corpus grew from 22,480 declarations to **59,756 declarations, 31,183 distinct spellings, and 30,205 distinct lowercase spellings across 39 source groups**. Counts describe extracted API declarations, not runtime calls or a census of every reachable public export. Repeated names across families remain visible as declarations but do not acquire extra training votes within a source.

| Ecosystem | Declarations | Distinct spellings within ecosystem | Source groups |
| --- | ---: | ---: | ---: |
| Blockchain RPCs | 641 | 611 | 6 |
| C++ / STL / Boost / Qt | 10,487 | 4,767 | 13 |
| JavaScript / web interfaces | 6,001 | 1,652 | 4 |
| Rust standard library and crates | 8,806 | 3,879 | 11 |
| Commercial and service APIs | 33,821 | 21,005 | 5 |

Distinct-spelling columns overlap across ecosystems and must not be summed.

New sources include LLVM libc++ standard-library synopses; Boost Asio, Beast, Container, MultiIndex, Filesystem, JSON, URL, Unordered, Algorithm and Math; Qt Core and Network; Rust std/core/alloc, Tokio, futures, serde, axum, reqwest, rayon, clap, regex, Diesel and Crossbeam; Bitcoin Core, Solana, Polkadot, Cosmos and CometBFT; and AWS, Stripe and GitHub/Octokit SDK declarations. The original Google, Ethereum, Kubernetes, DOM, ECMAScript, CCXT and ethers samples remain available.

All upstream inputs are pinned to immutable commits, with source/license hashes and extraction rules in the [expanded metadata](corpus-expanded-metadata.json) and linked shard metadata. Historical releases are intentional source samples where applicable. Downloaded corpus source is parsed as data rather than built or executed. C++ and Rust use declaration parsers; wire APIs use explicit RPC registrations, mappings or service declarations. Macro expansion and semantic export resolution are outside these extractors. The Rust shard explicitly records two rejected core files. C++ scope-recovery guards conservatively reject ambiguous declarations; parser statistics and limitations are recorded in its metadata.

## Correcting the concentration bias

The three profiles use the same codec architecture and evaluation names:

1. **Original data:** train the prototype on the original external corpus.
2. **Expanded data:** train it on distinct spellings from the expanded corpus.
3. **Expanded balanced:** give equal mass to ecosystems, then providers within each ecosystem, sources within each provider, and distinct spellings within each source.

The balanced profile gives Google **4.0%** of total training mass. Boost's many modules share one provider allocation. Overloads, repeated versions and repeated declarations within a source add no weight. This is an explicit diversity objective, not an estimate of real-world method-call frequency.

Psibase names measure compatibility only and are excluded from training. The 21 preferred descriptive names are also excluded from every profile. Service families use the original deterministic hash split. Every exact lowercase spelling present anywhere in the expanded training set is removed from all profiles' novel tests, making their evaluation set identical.

## Results on the same unseen names

These percentages measure complete lowercase recovery in the experimental eight-byte word/context/literal mixture, preserving digits and underscores. All three columns use that same prototype; the first column is not the current production codec. Ecosystem scores average sources within providers, then providers within ecosystems. The overall score gives each ecosystem equal weight. It is a chosen macro-average rather than a pooled success rate over declarations.

The common novel evaluation contains **5,854 distinct spellings**, with detailed per-source counts and length bands in [results-expanded.json](results-expanded.json).

| Novel evaluation ecosystem | Original data | Expanded data | Expanded balanced |
| --- | ---: | ---: | ---: |
| Blockchain RPCs | 52.0% | 59.0% | 63.8% |
| C++ / STL / Boost / Qt | 83.5% | 92.6% | 93.6% |
| JavaScript / web interfaces | 97.7% | 97.8% | 97.8% |
| Rust standard library and crates | 77.0% | 93.0% | 94.7% |
| Commercial and service APIs | 63.1% | 70.2% | 63.7% |
| **Balanced overall score** | **74.7%** | **82.5%** | **82.7%** |

On the 21 descriptive design probes, those profiles recover **15/21, 16/21, and 17/21**, respectively. These are curated probes that informed the earlier architecture, not a blind validation set. The broadened external holdouts are the more useful check of naming diversity. Training balance involves tradeoffs; per-source and length-band results should guide subsequent format choices rather than one aggregate percentage.

## Whole-ecosystem and provider holdouts

Additional runs remove an entire ecosystem or provider from training and test its novel spellings. They use expanded balanced training on the remaining sources. Exact lowercase overlap with the remaining training sources is still removed. Each row has a different evaluation population, so these percentages must not be compared directly with each other or the family-holdout table above. Single-family Solana and CometBFT APIs are covered by the blockchain holdout even when they have no family holdout in the main split.

| Entire source category excluded from training | Novel spellings tested | Balanced readable score |
| --- | ---: | ---: |
| All C++ sources | 4,289 | 87.8% |
| All Rust sources | 3,438 | 84.9% |
| All blockchain RPC sources | 577 | 74.6% |
| All Google API declarations | 5,768 | 76.8% |

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
