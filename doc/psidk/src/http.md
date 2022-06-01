# HTTP and Javascript

- [Routing and Virtual Hosts](#routing-and-virtual-hosts)
- - [CORS and authorization](#cors-and-authorization)
- [Native services](#native-services)
- - [Push transaction](#push-transaction)
- - [Boot chain](#boot-chain)
- [Common contract services](#common-contract-services)
- - [Pack transaction](#pack-transaction)
- - [Common files](#common-files)
- - - [RPC helpers](#rpc-helpers)
- - - - [Simple RPC wrappers](#simple-rpc-wrappers)
- - - - [Conversions](#conversions)
- - - - [Transactions](#transactions)
- - - [Signing](#signing)
- - - [React GraphQL hooks](#react-graphql-hooks)
- [Root services](#root-services)
- [Contract-provided services](#contract-provided-services)
- - [Packing actions](#packing-actions)

## Routing and Virtual Hosts

psinode provides virtual hosting. Domains have 2 categories:

- root domain, e.g. `psibase.127.0.0.1.sslip.io`. This hosts the main page for the chain and also provides contract-independent services.
- contract domain, e.g. `my-contract.psibase.127.0.0.1.sslip.io`. This hosts user interfaces and RPC services for individual contracts. Contracts must register for this service.

| Priority    | Domain   | Path       | Description                                                                           |
| ----------- | -------- | ---------- | ------------------------------------------------------------------------------------- |
| 1 (highest) | any      | `/native*` | [Native services](#native-services)                                                   |
| 2           | root     | `/common*` | [Common contract services](#common-contract-services)                                 |
| 3           | root     | `*`        | [Root services](#root-services)                                                       |
| 4           | contract | `/common*` | [Common contract services](#common-contract-services). Registered contracts only.     |
| 5 (lowest)  | contract | `*`        | [Contract-provided services](#contract-provided-services). Registered contracts only. |

The above table describes how psinode normally routes HTTP requests. Only the highest-priority rule is fixed. The [proxy-sys contract](system-contract/proxy-sys.md), which handles the remaining routing rules, is customizable, both by distinct chains and by individual node operators.

### CORS and authorization

psinode always accepts CORS requests, since services would break without it. psinode does not currently handle any HTTP authentication or authorization.

## Native services

psinode's native code handles any target which begins with `/native`, regardless of domain. Targets which begin with `/native` but aren't recognized produce a 404.

### Push transaction

`POST /native/push_transaction` pushes a transaction. The user must pack the transaction using fracpack and pass in the binary as the request body. See [Pack transaction](#pack-transaction) for an RPC request which packs transactions. TODO: describe how to pack without using RPC; currently waiting for the transaction format to stabilize, for schema support, and for WASM ABI support.

If the transaction succeeds, or if the transaction fails but a trace is available, then psinode returns a 200 reply with a JSON body (below). If the transaction fails and a trace is not available, then it returns a 500 error with an appropriate message.

```json
{
    "actionTraces": [...],  // Detailed execution information for debugging.
    "error": "..."          // Error message. Field will be empty or missing on success.
    // TODO: events?
}
```

If a transaction succeeds (above), the transaction may or may not make it into a block. If it does, it may get forked back out. TODO: add lifetime tracking and reporting to psinode.

Future psinode versions may trim the action traces when not in a developer mode.

### Boot chain

`POST /native/push_boot` boots the chain. This is only available when psinode does not have a chain yet. Use the `psibase boot` command to boot a chain. TODO: document the body content.

## Common contract services

- [Pack transaction](#pack-transaction)
- [Common files](#common-files)
- - [RPC helpers](#rpc-helpers)
- - - [Simple RPC wrappers](#simple-rpc-wrappers)
- - - [Conversions](#conversions)
- - - [Transactions](#transactions)
- - [Signing](#signing)
- - [React GraphQL hooks](#react-graphql-hooks)

The [common-sys contract](system-contract/common-sys.md) provides services which start with the `/common*` path across all domains. It handles RPC requests and serves files.

| Method | URL                              | Description                                                                                                               |
| ------ | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/common/thiscontract`           | Returns a JSON string containing the contract associated with the domain. If it's the root domain, returns `"common-sys"` |
| `GET`  | `/common/rootdomain`             | Returns a JSON string containing the root domain, e.g. `"psibase.127.0.0.1.sslip.io"`                                     |
| `GET`  | `/common/rootdomain.js`          | See below.                                                                                                                |
| `GET`  | `/common/rootdomain.mjs`         | See below.                                                                                                                |
| `POST` | `/common/pack/Transaction`       | [Packs a transaction](#pack-transaction)                                                                                  |
| `POST` | `/common/pack/SignedTransaction` | [Packs a signed transaction](#pack-transaction)                                                                           |
| `GET`  | `/common/<other>`                | [Common files](#common-files)                                                                                             |

`GET /common/rootdomain.js` returns a script like the following:

```
const rootdomain = 'psibase.127.0.0.1.sslip.io';

function siblingUrl(contract, path) {
    return location.protocol + '//' + (contract ? contract + '.' : '') +
           rootdomain + ':' + location.port + '/' + (path || '');
}
```

`GET /common/rootdomain.mjs` returns a script like the following:

```
export const rootdomain = 'psibase.127.0.0.1.sslip.io';

export function siblingUrl(contract, path) {
    return location.protocol + '//' + (contract ? contract + '.' : '') +
           rootdomain + ':' + location.port + '/' + (path || '');
}
```

`siblingUrl` makes it easy for scripts running on webpages served by psinode to reference other contracts' domains. It's not useful for scripts running on webpages served outside of psinode since it relies on `location.protocol` and `location.port`. `location.protocol` and `location.port` allows `siblingUrl` to navigate through reverse proxies, which may change the protocol (e.g. to HTTPS) or port (e.g. to 443).

Example uses:

- `siblingUrl('', '/foo/bar')`: Gets URL to `/foo/bar` on the root domain
- `siblingUrl('other-contract', '/foo/bar')`: Gets URL to `/foo/bar` on the `other-contract` domain

### Pack transaction

`/common/pack/Transaction` and `/common/pack/SignedTransaction` use fracpack to convert unsigned and signed transactions to binary. They accept JSON as input and return the binary data.

`Transaction` has these fields:

```
{
  "tapos": {
    "expiration": "..." // When transaction expires (UTC)
                        // Example value: "2022-05-31T21:32:23Z"
                        // Use `new Date(...)` to generate the correct format.
  },
  "actions": [],        // See Action
  "claims": []          // See Claim
}
```

TODO: document additional tapos fields once they're operational

`SignedTransaction` has these fields:

```
{
  "transaction": {},    // See Transaction above
  "proofs": []          // See Proof
}
```

`Action` has these fields. See [Packing actions](#packing-actions).

```
{
  "sender": "...",      // The account name authorizing the action
  "contract": "...",    // The contract name to receive the action
  "method": "...",      // The method name of the action
  "rawData": "..."      // Hex string containing action data (arguments)
}
```

`Claim` has these fields. See [Signing](#signing) to fill claims and proofs.

```
{
  "contract": "...",    // The contract which verifies the proof meets
                        // the claim, e.g. "verify-ec-sys"
  "rawData": "..."      // Hex string containing the claim data.
                        // e.g. `verify-ec-sys` expects a public key.
}
```

`Proof` is a hex string containing data which proves the claim. e.g. `verify-ec-sys` expects a signature. See [Signing](#signing) to fill claims and proofs.

### Common files

- [RPC helpers](#rpc-helpers)
- - [Simple RPC wrappers](#simple-rpc-wrappers)
- - [Conversions](#conversions)
- - [Transactions](#transactions)
- [Signing](#signing)
- [React GraphQL hooks](#react-graphql-hooks)

`common-sys` serves files stored in its tables. Chain operators may add files using the `storeSys` action (`psibase upload`). `psibase boot` installs this default set of files while booting the chain:

| Path                          | Description                                 |
| ----------------------------- | ------------------------------------------- |
| `/common/SimpleUI.mjs`        | Default UI for contracts under development  |
| `/common/rpc.mjs`             | [RPC helpers](#rpc-helpers)                 |
| `/common/useGraphQLQuery.mjs` | [React GraphQL hooks](#react-graphql-hooks) |

#### RPC helpers

`/common/rpc.mjs` exports a set of utilities to aid interacting with psinode's RPC interface.

##### Simple RPC wrappers

| Function or Type               | Description                                                                                                                                                                                        |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RPCError`                     | Error type. This extends `Error` with a new field, `trace`, which contains the trace returned by [`/native/push_transaction`](#push-transaction), if available.                                    |
| `throwIfError(response)`       | Throw an `RPCError` if the argument (a Response object) indicates a failure. Doesn't fill `trace` since traces are only present with status 200. Returns the argument (Response) if not a failure. |
| `get(url)`                     | Async function. fetch/GET. Uses `throwIfError`. Returns Response object if ok.                                                                                                                     |
| `getJson(url)`                 | Async function. fetch/GET. Uses `throwIfError`. Returns JSON if ok.                                                                                                                                |
| `getText(url)`                 | Async function. fetch/GET. Uses `throwIfError`. Returns text if ok.                                                                                                                                |
| `postArrayBuffer(url, data)`   | Async function. fetch/POST ArrayBuffer. Uses `throwIfError`. Returns Response object if ok.                                                                                                        |
| `postArrayBufferGetJson(data)` | Async function. fetch/POST ArrayBuffer. Uses `throwIfError`. Returns JSON if ok.                                                                                                                   |
| `postGraphQL(url, data)`       | Async function. fetch/POST GraphQL. Uses `throwIfError`. Returns Response object if ok.                                                                                                            |
| `postGraphQLGetJson(data)`     | Async function. fetch/POST GraphQL. Uses `throwIfError`. Returns JSON if ok.                                                                                                                       |
| `postJson(url, data)`          | Async function. fetch/POST JSON. Uses `throwIfError`. Returns Response object if ok.                                                                                                               |
| `postJsonGetArrayBuffer(data)` | Async function. fetch/POST JSON. Uses `throwIfError`. Returns ArrayBuffer if ok.                                                                                                                   |
| `postJsonGetJson(data)`        | Async function. fetch/POST JSON. Uses `throwIfError`. Returns JSON if ok.                                                                                                                          |
| `postJsonGetText(data)`        | Async function. fetch/POST JSON. Uses `throwIfError`. Returns text if ok.                                                                                                                          |
| `postText(url, data)`          | Async function. fetch/POST text. Uses `throwIfError`. Returns Response object if ok.                                                                                                               |
| `postTextGetJson(data)`        | Async function. fetch/POST text. Uses `throwIfError`. Returns JSON if ok.                                                                                                                          |

##### Conversions

| Function                | Description                            |
| ----------------------- | -------------------------------------- |
| `hexToUint8Array(data)` | Converts a hex string to a Uint8Array. |
| `uint8ArrayToHex(data)` | Converts a Uint8Array to a hex string. |

##### Transactions

| Function                                 | Description                                                                                                                                                                                                           |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packTransaction(baseUrl, trx)`          | Async function. Packs a transaction. Returns ArrayBuffer if ok. See [Pack transaction](#pack-transaction).                                                                                                            |
| `packSignedTransaction(baseUrl, trx)`    | Async function. Packs a signed transaction. Returns ArrayBuffer if ok. See [Pack transaction](#pack-transaction).                                                                                                     |
| `pushPackedTransaction(baseUrl, packed)` | Async function. Pushes a packed signed transaction. If the transaction succeeds, then returns the trace. If it fails, throws `RPCError`, including the trace if available. See [Push transaction](#push-transaction). |
| `pushedSignedTransaction(baseUrl, trx)`  | Async function. Packs then pushes a signed transaction. If the transaction succeeds, then returns the trace. If it fails, throws `RPCError`, including the trace if available.                                        |

#### Signing

TODO

#### React GraphQL hooks

TODO

## Root services

TODO

## Contract-provided services

TODO

### Packing actions

TODO
