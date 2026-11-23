# Adding the four missed Psibase names

Experiment date: 2026-11-23. This follows the [expanded external-only experiment](EXPANDED-CORPUS.md), using the same word/context/literal architecture and the same external holdout. Production codecs and the earlier result artifacts remain unchanged.

The added names are `cpu_blocks_avg`, `cpu_thresholds`, `set_guild_weight_curve`, and `unreg_res_provider`. None occurs in the external corpus. The base training set has 25,128 weighted spellings. An ordinary added name receives the average existing-name vote; all original relative weights are preserved. Higher multipliers are targeted weighting rather than additional independent examples.

| Weight per added name | Current Psibase names readable | External balanced score | Descriptive probes readable |
| --- | ---: | ---: | ---: |
| No additions | 524 / 528 | 82.74% | 17 / 21 |
| 1 ordinary vote | 526 / 528 | 82.72% | 17 / 21 |
| 10 votes | 528 / 528 | 82.75% | 15 / 21 |
| 100 votes | 528 / 528 | 82.91% | 16 / 21 |
| 1,000 votes | 527 / 528 | 82.46% | 15 / 21 |

At ordinary weight, `cpu_blocks_avg` and `cpu_thresholds` become readable. `set_guild_weight_curve` and `unreg_res_provider` still do not fit. At 10 times that weight, all 528 current names fit without shortening. The four added names occupy 0.159% of training mass, and no previously readable current Psibase name is lost.

The external test population remains 5,854 novel spellings throughout. At 10 votes, pooled readable coverage changes from 4,140 to 4,144: 10 names gain readable encoding and 6 lose it. The macro score is a provider/ecosystem-balanced average, so it is a different statistic from this pooled count. Its 0.01 percentage-point change is essentially unchanged performance. The separate descriptive probes lose two successes, illustrating the tradeoff within a fixed-size statistical format. At 1,000 votes, `invitesByInviter` also loses readable encoding.

The four added names now measure training-set fit. The external names and descriptive probes remain excluded from training; their results are exploratory comparisons, not a blind production-format validation. Rare components need sufficient frequency to enter the component dictionary, so merely appearing once does not guarantee that an entire method fits. Names are not stored as a direct lookup table of whole-method exceptions.

Every successful evaluated encoding is checked for complete lowercase decode, exact numeric re-encoding, and unintended collisions among evaluated canonical names. Baseline local coverage, external coverage and macro scores are asserted against the frozen earlier results. Each variant records paired gains and losses rather than only a net count.

Reproduce with:

```sh
python3 experiments/method-names/targeted_training.py
```

[results-targeted-training.json](results-targeted-training.json) contains exact weights, per-name payload lengths, gains/losses, length bands and source/reference hashes. [targeted_training.py](targeted_training.py) does not rewrite any external-only experiment artifact.
