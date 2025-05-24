# Table details

# RTransact Table Operations

## Table Operations Overview

```mermaid
graph TD
    subgraph "Table Operations"
        A[pushTransaction] -->|add| B[PendingTransactionTable]
        A -->|add| C[TransactionDataTable]
        A -->|add| E[TraceClientTable]

        F[onTrx] -->|add| G[BlockTxsTable]

        H[onBlock] -->|add| I[ReversibleBlocksTable]
        H -->|delete| J[BlockTxsTable]
        H -->|delete| K[PendingTransactionTable]
        H -->|delete| L[TransactionDataTable]
        H -->|delete| M[TraceClientTable]
    end
```

## RTransact Tables

### PendingTransactionTable

Example:

| id        | expiration           | ctime                | sequence |
| --------- | -------------------- | -------------------- | -------- |
| abc123... | 2023-12-01T00:00:00Z | 2023-11-01T00:00:00Z | 1        |
| def456... | 2023-12-02T00:00:00Z | 2023-11-02T00:00:00Z | 2        |
| ghi789... | 2023-12-03T00:00:00Z | 2023-11-03T00:00:00Z | 3        |

```mermaid
graph TD
    subgraph "PendingTransactionTable"
        A[pushTransaction] -->|Add| B[Add new pending transaction]
        H[onBlock] -->|Remove| C[Remove expired transactions]
    end
```

### TransactionDataTable

Example:

| id        | trx                |
| --------- | ------------------ |
| abc123... | SignedTransaction1 |
| def456... | SignedTransaction2 |
| ghi789... | SignedTransaction3 |

```mermaid
graph TD
    subgraph "Operations"
        A[pushTransaction] -->|Add| B[Add transaction data]
        H[onBlock] -->|Remove| C[Remove expired transaction data]
    end
```

### BlockTxsTable

Example:

| blockNum | id        | trace             |
| -------- | --------- | ----------------- |
| 1        | abc123... | TransactionTrace1 |
| 2        | def456... | TransactionTrace2 |
| 3        | ghi789... | TransactionTrace3 |

```mermaid
graph TD
    subgraph "BlockTxsTable"
        F[onTrx] -->|Add| B[Add transaction trace]
        H[onBlock] -->|Remove| C[Remove irreversible traces]
    end
```

### ReversibleBlocksTable

Example:

| blockNum | time                 |
| -------- | -------------------- |
| 1        | 2023-11-01T00:00:00Z |
| 2        | 2023-11-02T00:00:00Z |
| 3        | 2023-11-03T00:00:00Z |

```mermaid
graph TD
    subgraph "ReversibleBlocksTable"
        H[onBlock] -->|Add| B[Add new block]
        H[onBlock] -->|Remove| C[Remove irreversible blocks]
    end
```

### TraceClientTable

| id        | clients                        |
| --------- | ------------------------------ |
| abc123... | [{"socket": 1, "json": true}]  |
| def456... | [{"socket": 2, "json": false}] |
| ghi789... | [{"socket": 3, "json": true}]  |

```mermaid
graph TD
    subgraph "TraceClientTable"
        A[pushTransaction] -->|Add| B[Add client waiting for trace]
        H[onBlock] -->|Remove| C[Remove clients after sending trace]
    end
```

### AvailableSequenceTable

Example:

| nextSequence |
| ------------ |
| 1001         |
| 1002         |
| 1003         |

```mermaid
graph TD
    subgraph "AvailableSequenceTable"
        A[pushTransaction] -->|Update| B[Increment next sequence]
    end
```

### UnappliedTransactionTable

Example:

| nextSequence |
| ------------ |
| 1000         |
| 1001         |
| 1002         |

```mermaid
graph TD
    subgraph "UnappliedTransactionTable"
        N[next] -->|Update| B[Update next sequence]
    end
```

### JWTKeyTable

```mermaid
graph TD
    subgraph "JWTKeyTable"
        A[getJWTKey] -->|Add| B[Add new key if none exists]
    end
```
