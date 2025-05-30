# Table details

# RTransact Table Operations

## Table Operations Overview

```mermaid
graph TD
    subgraph "Functions"
        A[pushTransaction]
        F[onTrx]
        H[onBlock]
    end

    subgraph "Tables"
        B[PendingTransactionTable]
        C[TransactionDataTable]
        E[TraceClientTable]
        G[TxSuccessTable]
        G2[TxFailedTable]
        I[ReversibleBlocksTable]
        K[PendingTransactionTable]
        L[TransactionDataTable]
        M[TraceClientTable]
    end

    A -->|add| B
    A -->|add| C
    A -->|add| E

    F -->|add| G
    F -->|add| G2
    F -->|delete: waitfor=applied| G
    F -->|delete: waitfor=applied| G2

    H -->|add| I
    H -->|delete: waitfor=final| G
    H -->|delete: waitfor=final| G2
    H -->|delete| K
    H -->|delete| L
    H -->|delete| M
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

### TxSuccessTable

Example:

| id        | blockNum | trace             |
| --------- | -------- | ----------------- |
| abc123... | 1        | TransactionTrace1 |
| def456... | 2        | TransactionTrace2 |
| ghi789... | 3        | TransactionTrace3 |

Note: Deletion can occur in two places:
- In `onTrx` when `waitfor=applied` (immediate deletion after sending trace)
- In `onBlock` when `waitfor=final` (deletion after transaction becomes irreversible)

```mermaid
graph TD
    subgraph "TxSuccessTable"
        F[onTrx] -->|Add| B[Add successful transaction trace]
        F -->|delete: waitfor=applied| C[Remove after sending trace]
        H[onBlock] -->|delete: waitfor=final| D[Remove irreversible traces]
    end
```

### TxFailedTable

Example:

| id        | trace             |
| --------- | ----------------- |
| abc123... | TransactionTrace1 |
| def456... | TransactionTrace2 |
| ghi789... | TransactionTrace3 |

Note: Deletion can occur in two places:
- In `onTrx` when `waitfor=applied` (immediate deletion after sending trace)
- In `onBlock` when `waitfor=final` (deletion after transaction is expired)

```mermaid
graph TD
    subgraph "TxFailedTable"
        F[onTrx] -->|Add| B[Add failed transaction trace]
        F -->|delete: waitfor=applied| C[Remove after sending trace]
        H[onBlock] -->|delete: waitfor=final| D[Remove expired traces]
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
