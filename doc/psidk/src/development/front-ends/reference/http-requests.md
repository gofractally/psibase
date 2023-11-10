# HTTP routing table

| Priority    | Domain  | Path       | Description                                                                         |
| ----------- | ------- | ---------- | ----------------------------------------------------------------------------------- |
| 1 (highest) | any     | `/native*` | [Native endpoints](#native-endpoints)                                               |
| 2           | root    | `/common*` | [Common endpoints](#common-endpoints)                                               |
| 3           | root    | `*`        | [Root endpoints](#root-endpoints)                                                   |
| 4           | service | `/common*` | [Common endpoints](#common-endpoints). Registered services only.                    |
| 5 (lowest)  | service | `*`        | [Service-provided endpoints](#service-provided-endpoints). Registered services only.|

The above table describes how psinode normally routes HTTP requests. Only the highest-priority rule is fixed. The [proxy-sys service](../../../default-apps/proxy-sys.md), which handles the remaining routing rules, is customizable, both by distinct networks and by individual infrastructure providers.

## CORS and authorization

psinode always accepts CORS requests, since services would break without it. psinode does not currently handle any HTTP authentication or authorization.


## Native endpoints

psinode's native code handles any target which begins with `/native`, regardless of domain. Targets which begin with `/native` but aren't recognized produce a 404. 

The primary endpoint needed by front-end developers is the [/native/push_transaction](#push-transaction) endpoint. The rest of the native endpoints are primarily useful for node administration and can therefore be found documented in the [administration docs](../../../run-infrastructure/administration.md).

### Push transaction

`POST /native/push_transaction` pushes a transaction. The user must pack the transaction using fracpack and pass in the binary as the request body. See [Pack transaction](#pack-transaction) for an RPC request which packs transactions. 

> ➕ TODO: describe how to pack without using RPC; currently waiting for the transaction format to stabilize, for schema support, and for WASM ABI support.

If the transaction succeeds, or if the transaction fails but a trace is available, then psinode returns a 200 reply with a JSON body (below). If the transaction fails and a trace is not available, then it returns a 500 error with an appropriate message.

```json
{
    "actionTraces": [...],  // Detailed execution information for debugging.
    "error": "..."          // Error message. Field will be empty or missing on success.
    // TODO: events?
}
```

If a transaction succeeds, the transaction may or may not make it into a block. If it makes it into a block, it may get forked back out. 

> ➕ TODO: add lifetime tracking and reporting to psinode.

Future psinode versions may trim the action traces when not in a developer mode.

## Common endpoints

The [common-sys service](../../../default-apps/common-sys.md) endpoints which start with the `/common*` path across all domains. It handles RPC requests and serves files.

| Method | URL                              | Description                                                                                                              |
| ------ | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `GET`  | `/common/tapos/head`             | Returns [TaPoS](#tapos) for the current head block                                                                       | 
| `GET`  | `/common/thisservice`            | Returns a JSON string containing the service associated with the domain. If it's the root domain, returns `"common-sys"` |
| `GET`  | `/common/rootdomain`             | Returns a JSON string containing the root domain, e.g. `"psibase.127.0.0.1.sslip.io"`                                    |
| `POST` | `/common/pack/Transaction`       | [Packs a transaction](#pack-transaction)                                                                                 |
| `POST` | `/common/pack/SignedTransaction` | [Packs a signed transaction](#pack-signed-transaction)                                                                   |
| `GET`  | `/common/<other>`                | [Common files](#common-files)                                                                                            |

### Tapos

`GET /common/tapos/head` returns the TaPoS information for the current head block. To learn more about TaPoS and its purpose, see the the [specification document](../../../specifications/blockchain/tapos.md).

The TaPoS information returned from this endpoint has these fields:
```json
{
  "refBlockIndex": ...,   // Identifies block
  "refBlockSuffix": ...   // Identifies block
}
```

TaPoS must be attached to every transaction submitted to a psibase network. In addition to the `refBlockIndex` and `refBlockSuffix`, TaPoS information in a transaction requires an additional `expiration` field identifying a time after which the transaction is considered expired and can no longer be applied.

### Pack transaction

`POST /common/pack/Transaction` and `POST /common/pack/SignedTransaction` use [fracpack](../../../specifications/data-formats/fracpack.md) to convert unsigned and signed transactions to binary. They accept JSON as input and return the binary data.

`Transaction` has these fields:
```json
{
  "tapos": {                // See [tapos](#tapos)
    "refBlockIndex": ...,   // Identifies block
    "refBlockSuffix": ...,  // Identifies block
    "expiration": "..."     // When transaction expires (UTC)
                            // Example value: "2022-05-31T21:32:23Z"
                            // Use `new Date(...)` to generate the correct format.
  },
  "actions": [],            // See Action
  "claims": []              // See Claim
}
```

`SignedTransaction` has these fields:
```json
{
  "transaction": {},    // This may be the Transaction object (above),
                        // or it may be a hex string containing the packed
                        // transaction.
  "proofs": []          // See Proof
}
```


`Action` has these fields. To pack the action arguments, see `pack_action` in the [service-provided endpoints](#service-provided-endpoints).
```json
{
  "sender": "...",      // The account name authorizing the action
  "service": "...",     // The service name to receive the action
  "method": "...",      // The method name of the action
  "rawData": "..."      // Hex string containing packed action arguments
}
```

`Claim` has these fields. See [Signing (js)](#signing-js) to fill claims and proofs.
```json
{
  "service": "...",     // The service which verifies the proof meets
                        // the claim, e.g. "verifyec-sys"
  "rawData": "..."      // Hex string containing the claim data.
                        // e.g. `verifyec-sys` expects a public key
                        // in fracpack format.
}
```

`Proof` is a hex string containing data which proves the claim. e.g. `verifyec-sys` expects a signature in fracpack format. See [Signing (js)](#signing-js) to fill claims and proofs.

### Pack signed transaction

> ➕ TODO

### Common files

`common-sys` serves files stored in its tables. Chain operators may add files using the `storeSys` action (`psibase upload`). 
Booting the network with either the psibase CLI tool or with the admin-sys app will automatically install this default set of files:

| Path                          | Description                                                                                                                                                           |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/common/SimpleUI.mjs`        | Default UI for services under development ([Learn more](../../services/cpp-service/minimal-ui/))                                                                      |
| `/common/rpc.mjs`             | [Simple RPC wrappers (js)](#simple-rpc-wrappers-js)<br/>[Conversions (js)](#conversions-js)<br/>[Transactions (js)](#transactions-js)<br/>[Signing (js)](#signing-js) |
| `/common/keyConversions.mjs`  | [Key Conversions (js)](#key-conversions-js)                                                                                                                           |
| `/common/useGraphQLQuery.mjs` | [React GraphQL hooks (js)](#react-graphql-hooks-js)                                                                                                                   |

## Root endpoints

The root domain always serves the code for the [supervisor](../../../specifications/app-architecture/supervisor.md). If a subpage of the root domain is accessed, the supervisor client-code is what evaluates the subpage and determines how to react.

Currently, the supervisor uses the `/applet/` prefix to trigger loading a psibase app within a managed iframe according to the supervisor specification.

## Service-provided endpoints

When you define a custom RPC handler, you have the ability to implement custom endpoints that your service can handle.

However, there are several reference libraries that have been developed to simplify serving some common and helpful service-specific endpoints. To learn how to use these libraries to enable these endpoints for your service, please reference either the [C++ Web Services](../../services/cpp-service/reference/web-services.md) or [Rust Web Services](../../services/rust-service/reference/web-services.md) documentation depending on whatever is relevant to you.

The endpoints that can currently be enabled are:
* [`GET /action_templates`](#action-templates)
* [`POST /pack_action/x`](#pack_action)
* [`GET /`](#simple-ui)

### Action templates

A request to `GET /action_templates` returns a JSON object containing a field for each action in Service. The field names match the action names. The field values are objects with the action arguments, each containing sample data.

### Pack action

`POST /pack_action/x` is an endpoint that can help you pack calls to actions in a service. `x` is the name of the service action defined on this service, and the body of the request should be a JSON object containing all of the arguments to that action. To get a sample JSON object for an action and its arguments, you can use the [action_templates](#action_templates) endpoint.

This endpoint will parse the JSON body, packs the action and its arguments using [fracpack](../../../specifications/data-formats/fracpack.md), and then return the result as an `application/octet-stream`. This is helpful for when you're manually [packing a transaction](#pack-transaction).

### Simple UI

If this endpoint is enabled and called, then it will return a very small HTML body:
```html
<html>
<div id="root" class="ui container"></div>
<script src="/common/SimpleUI.mjs" type="module"></script>
</html>
```

This simply calls the SimpleUI.mjs endpoint to present a simple user-interface that can be helpful during service development.
