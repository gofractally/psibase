# HTTP and Javascript

## Routing and Virtual Hosts

psinode provides virtual hosting. Domains have 2 categories:

- root domain, e.g. `psibase.127.0.0.1.sslip.io`. This hosts the main page for the chain and also provides contract-independent services.
- contract domain, e.g. `my-contract.psibase.127.0.0.1.sslip.io`. This hosts user interfaces and RPC services for individual contracts. Contracts must register for this service.

| priority    | domain   | path       | description                                                                           |
| ----------- | -------- | ---------- | ------------------------------------------------------------------------------------- |
| 1 (highest) | any      | `/native*` | [Native services](#native-services)                                                   |
| 2           | root     | `/common*` | [Common contract services](#common-contract-services)                                 |
| 3           | root     | `*`        | [Root services](#root-services)                                                       |
| 4           | contract | `/common*` | [Common contract services](#common-contract-services). Registered contracts only.     |
| 5 (lowest)  | contract | `*`        | [Contract-provided services](#contract-provided-services). Registered contracts only. |

The above table describes how psinode normally routes HTTP requests. Only the highest-priority rule is fixed. The [proxy-sys contract](system-contract/proxy-sys.md), which handles the remaining routing rules, is customizable, both by distinct chains and by individual node operators.

### CORS and authorization

psinode always accepts CORS requests, since services would break without it. psinode currently does not handle any authentication or authorization except when validating transactions.

## Native services

psinode's native code handles any target which begins with `/native`, regardless of domain. Targets which begin with `/native` but aren't recognized produce a 404.

### Push transaction

`POST /native/push_transaction` pushes a transaction. The user must pack the transaction using fracpack and pass in the binary as the request body. See [Pack transaction](#pack-transaction) for an RPC request which packs transactions. TODO: describe how to pack without using RPC; currently waiting for the transaction format to stabilize, for schema support, and for WASM ABI support.

The transaction my succeed or fail on the local psinode instance. If it succeeds, then the request returns success status. This does not indicate the transaction made it on chain; it may fail to propagate through the network or it may get lost on a fork. TODO: add lifetime tracking and reporting to psinode.

If the transaction succeeds, or if the transaction fails but a trace is available, then psinode returns a 200 reply with a JSON body (below). If the transaction fails and a trace is not available, then it returns a 500 error with an appropriate message.

```json
{
    "actionTraces": [...],  // Detailed execution information for debugging.
    "error": "..."          // Error message. Field will be empty or missing on success.
    // TODO: events?
}
```

Future psinode versions may trim the action traces when not in a developer mode.

### Boot chain

`POST /native/push_boot` boots the chain. This is only available when psinode does not have a chain yet. Use the `psibase boot` command to boot a chain. TODO: document the body content.

## Common contract services

### Pack transaction

## Root services

## Contract-provided services
