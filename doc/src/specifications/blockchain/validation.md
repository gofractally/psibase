# Validation

[TaPoS](./tapos.md) has an extremely powerful implication: as long as there is decentralized validation, a psibase network that is completely centralized with only a single producer would not be at risk of a double-spend attack. Any attempt to double spend would be immediately detected and the proposed fork blocks would fail to validate. Therefore, it is worth carefully considering the task of validation to ensure that it can be accomplished and allow a community to detect any attempt at malicious behavior by the block producer.

## Goals

1. Ensure validation can be accomplished at low cost
2. Ensure full chain validation capabilities remain possible

## Design

> ➕ Todo: The psibase validation design specification has not yet been documented.