# HTTP and Javascript

- [Routing and Virtual Hosts](#routing-and-virtual-hosts)
  - [CORS and authorization](#cors-and-authorization)
- [Native services](#native-services)
  - [Push transaction](#push-transaction)
  - [Boot chain](#boot-chain)
- [Common contract services](#common-contract-services)
  - [Pack transaction](#pack-transaction)
  - [Common files](#common-files)
    - [RPC helpers](#rpc-helpers)
      - [Simple RPC wrappers](#simple-rpc-wrappers)
      - [Conversions](#conversions)
      - [Transactions](#transactions)
    - [Key Conversions](#key-conversions)
    - [Signing](#signing)
    - [React GraphQL hooks](#react-graphql-hooks)
- [Root services](#root-services)
- [Contract-provided services](#contract-provided-services)
  - [Packing actions](#packing-actions)

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
  - [RPC helpers](#rpc-helpers)
    - [Simple RPC wrappers](#simple-rpc-wrappers)
    - [Conversions](#conversions)
    - [Transactions](#transactions)
  - [Key Conversions](#key-conversions)
  - [Signing](#signing)
  - [React GraphQL hooks](#react-graphql-hooks)

The [common-sys contract](system-contract/common-sys.md) provides services which start with the `/common*` path across all domains. It handles RPC requests and serves files.

| Method | URL                              | Description                                                                                                               |
| ------ | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/common/thiscontract`           | Returns a JSON string containing the contract associated with the domain. If it's the root domain, returns `"common-sys"` |
| `GET`  | `/common/rootdomain`             | Returns a JSON string containing the root domain, e.g. `"psibase.127.0.0.1.sslip.io"`                                     |
| `GET`  | `/common/rootdomain.js`          | See [rootdomain and siblingUrl](#rootdomain-and-siblingurl)                                                               |
| `GET`  | `/common/rootdomain.mjs`         | See [rootdomain and siblingUrl](#rootdomain-and-siblingurl)                                                               |
| `POST` | `/common/pack/Transaction`       | [Packs a transaction](#pack-transaction)                                                                                  |
| `POST` | `/common/pack/SignedTransaction` | [Packs a signed transaction](#pack-transaction)                                                                           |
| `GET`  | `/common/<other>`                | [Common files](#common-files)                                                                                             |

### rootdomain and siblingUrl

`GET /common/rootdomain.mjs` returns a script like the following:

```
export const rootdomain = 'psibase.127.0.0.1.sslip.io';

export function siblingUrl(baseUrl, contract, path) {
    let loc;
    if (!baseUrl)
        loc = location;
    else
        loc = new URL(baseUrl);
    return loc.protocol + '//' + (contract ? contract + '.' : '') + rootdomain +
           ':' + loc.port + '/' + (path || '').replace(/^\/+/, '');
}
```

`GET /common/rootdomain.js` returns the same thing, but without the `export` keyword.

`siblingUrl` makes it easy for scripts to reference other contracts' domains. It automatically navigates through reverse proxies, which may change the protocol (e.g. to HTTPS) or port (e.g. to 443) from what psinode provides. If `baseUrl` is null or undefined, then this relies on `location.protocol` and `location.port`; this mode is only usable by scripts running on webpages served by psinode.

Example uses:

- `siblingUrl(null, '', '/foo/bar')`: Gets URL to `/foo/bar` on the root domain. This form is only usable by scripts running on webpages served by psinode.
- `siblingUrl(null, 'other-contract', '/foo/bar')`: Gets URL to `/foo/bar` on the `other-contract` domain. This form is only usable by scripts running on webpages served by psinode.
- `siblingUrl('http://psibase.127.0.0.1.sslip.io:8080/', '', '/foo/bar')`: Like above, but usable by scripts running on webpages served outside of psinode.
- `siblingUrl('http://psibase.127.0.0.1.sslip.io:8080/', 'other-contract', '/foo/bar')`: Like above, but usable by scripts running on webpages served outside of psinode.

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
  - [Simple RPC wrappers](#simple-rpc-wrappers)
  - [Conversions](#conversions)
  - [Transactions](#transactions)
- [Key Conversions](#key-conversions)
- [Signing](#signing)
- [React GraphQL hooks](#react-graphql-hooks)

`common-sys` serves files stored in its tables. Chain operators may add files using the `storeSys` action (`psibase upload`). `psibase boot` installs this default set of files while booting the chain:

| Path                          | Description                                 |
| ----------------------------- | ------------------------------------------- |
| `/common/SimpleUI.mjs`        | Default UI for contracts under development  |
| `/common/rpc.mjs`             | [RPC helpers](#rpc-helpers)                 |
| `/common/keyConversions.mjs`  | [Key Conversions](#key-conversions)         |
| `/common/useGraphQLQuery.mjs` | [React GraphQL hooks](#react-graphql-hooks) |

#### RPC helpers

`/common/rpc.mjs` exports a set of utilities to aid interacting with psinode's RPC interface.

##### Simple RPC wrappers

| Function or Type                      | Description                                                                                                                                                                                        |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RPCError`                            | Error type. This extends `Error` with a new field, `trace`, which contains the trace returned by [`/native/push_transaction`](#push-transaction), if available.                                    |
| `throwIfError(response)`              | Throw an `RPCError` if the argument (a Response object) indicates a failure. Doesn't fill `trace` since traces are only present with status 200. Returns the argument (Response) if not a failure. |
| `siblingUrl(baseUrl, contract, path)` | Reexport of `siblingUrl` from [rootdomain and siblingUrl](#rootdomain-and-siblingurl).                                                                                                             |
| `get(url)`                            | Async function. fetch/GET. Uses `throwIfError`. Returns Response object if ok.                                                                                                                     |
| `getJson(url)`                        | Async function. fetch/GET. Uses `throwIfError`. Returns JSON if ok.                                                                                                                                |
| `getText(url)`                        | Async function. fetch/GET. Uses `throwIfError`. Returns text if ok.                                                                                                                                |
| `postArrayBuffer(url, data)`          | Async function. fetch/POST ArrayBuffer. Uses `throwIfError`. Returns Response object if ok.                                                                                                        |
| `postArrayBufferGetJson(data)`        | Async function. fetch/POST ArrayBuffer. Uses `throwIfError`. Returns JSON if ok.                                                                                                                   |
| `postGraphQL(url, data)`              | Async function. fetch/POST GraphQL. Uses `throwIfError`. Returns Response object if ok.                                                                                                            |
| `postGraphQLGetJson(data)`            | Async function. fetch/POST GraphQL. Uses `throwIfError`. Returns JSON if ok.                                                                                                                       |
| `postJson(url, data)`                 | Async function. fetch/POST JSON. Uses `throwIfError`. Returns Response object if ok.                                                                                                               |
| `postJsonGetArrayBuffer(data)`        | Async function. fetch/POST JSON. Uses `throwIfError`. Returns ArrayBuffer if ok.                                                                                                                   |
| `postJsonGetJson(data)`               | Async function. fetch/POST JSON. Uses `throwIfError`. Returns JSON if ok.                                                                                                                          |
| `postJsonGetText(data)`               | Async function. fetch/POST JSON. Uses `throwIfError`. Returns text if ok.                                                                                                                          |
| `postText(url, data)`                 | Async function. fetch/POST text. Uses `throwIfError`. Returns Response object if ok.                                                                                                               |
| `postTextGetJson(data)`               | Async function. fetch/POST text. Uses `throwIfError`. Returns JSON if ok.                                                                                                                          |

##### Conversions

| Function                | Description                            |
| ----------------------- | -------------------------------------- |
| `hexToUint8Array(data)` | Converts a hex string to a Uint8Array. |
| `uint8ArrayToHex(data)` | Converts a Uint8Array to a hex string. |

##### Transactions

| Function                                       | Description                                                                                                                                                                                                                                                                                            |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packAction(baseUrl, action)`                  | Async function. Packs an action if needed. Returns a new action. An action is an object with fields `sender`, `contract`, `method`, and either `data` or `rawData`. If `rawData` is present then it's already packed. Otherwise this function uses [Packing actions RPC](#packing-actions) to pack it. |
| `packActions(baseUrl, actions)`                | Async function. Packs an array of actions.                                                                                                                                                                                                                                                             |
| `packTransaction(baseUrl, trx)`                | Async function. Packs a transaction. Also packs any actions within it, if needed. Returns ArrayBuffer if ok. See [Pack transaction](#pack-transaction).                                                                                                                                                |
| `packSignedTransaction(baseUrl, trx)`          | Async function. Packs a signed transaction. Returns ArrayBuffer if ok. See [Pack transaction](#pack-transaction).                                                                                                                                                                                      |
| `pushPackedSignedTransaction(baseUrl, packed)` | Async function. Pushes a packed signed transaction. If the transaction succeeds, then returns the trace. If it fails, throws `RPCError`, including the trace if available. See [Push transaction](#push-transaction).                                                                                  |
| `packAndPushSignedTransaction(baseUrl, trx)`   | Async function. Packs then pushes a signed transaction. If the transaction succeeds, then returns the trace. If it fails, throws `RPCError`, including the trace if available.                                                                                                                         |

#### Key Conversions

`/common/keyConversions.mjs` has functions which convert [Elliptic KeyPair objects](https://github.com/indutny/elliptic) to and from psibase's text and binary forms. Each function accepts or returns a `{keyType, keyPair}`, where keyType is one of the following values:

```js
export const KeyType = {
  k1: 0,
  r1: 1,
};
```

Here are example private and public keys in text form:

```
PVT_K1_2bfGi9rYsXQSXXTvJbDAPhHLQUojjaNLomdm3cEJ1XTzMqUt3V
PUB_K1_6MRyAjQq8ud7hVNYcfnVPJqcVpscN5So8BhtHuGYqET5BoDq63

PVT_R1_fJ6ASApAc9utAL4zfNE4qwo22p7JpgHHSCVJ9pQfw4vZPXCq3
PUB_R1_7pGpnu7HZVwi8kiLLDK2MJ6aYYS23eRJYmDXSLq5WZFCN6WEqY
```

TODO: even though the JS library supports both k1 and r1 types, psibase only currently supports k1.

| Function                                         | Description                                                     |
| ------------------------------------------------ | --------------------------------------------------------------- |
| `privateStringToKeyPair(s)`                      | Convert a private key in string form to `{keyType, keyPair}`    |
| `publicStringToKeyPair(s)`                       | Convert a public key in string form to `{keyType, keyPair}`     |
| `privateKeyPairToString({keyType, keyPair})`     | Convert the private key in `{keyType, keyPair}` to a string     |
| `publicKeyPairToString({keyType, keyPair})`      | Convert the public key in `{keyType, keyPair}` to a string      |
| `privateKeyPairToUint8Array({keyType, keyPair})` | Convert the private key in `{keyType, keyPair}` to a Uint8Array |
| `publicKeyPairToUint8Array({keyType, keyPair})`  | Convert the public key in `{keyType, keyPair}` to a Uint8Array  |

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
