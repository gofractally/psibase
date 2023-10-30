# External apps

It is possible to build third-party apps & scripts that interact with a psibase deployment. To do so however requires the developer to manually do more of the heavy-lifting regarding key management and transaction packing. 

External apps are also unable to engage client-side interfaces and use inter-app communication.

## TLDR: Pushing a transaction

This example works directly in the browser without bundling, transpiling, etc.

TODO: npm package which supports bundling

<!-- prettier-ignore -->
```html
<!DOCTYPE html>
<html>
    <body>
        See the console

        <!-- type="module" enables es6 imports -->
        <!-- it also allows using await outside of functions -->
        <script src="script.mjs" type="module"></script>
    </body>
</html>
```

<!-- prettier-ignore -->
```js
// Use these if your script is NOT hosted by psinode:
import { getTaposForHeadBlock, signAndPushTransaction }
    from 'http://psibase.127.0.0.1.sslip.io:8080/common/rpc.mjs';
const baseUrl = 'http://psibase.127.0.0.1.sslip.io:8080';

// Use these if your script is hosted by psinode:
//    import {getTaposForHeadBlock, signAndPushTransaction} from '/common/rpc.mjs';
//    const baseUrl = '';

try {
    const transaction = {
        tapos: {
            ...await getTaposForHeadBlock(baseUrl),
            // expire after 10 seconds
            expiration: new Date(Date.now() + 10000),
        },
        actions: [
            {
                sender: "sue",          // account requesting action
                service: "example",     // service executing action
                method: "add",          // method to execute
                data: {                 // arguments to method
                    "a": 0,
                    "b": 0
                }
            }
        ],
    };
    const privateKeys = [
        'PVT_K1_2bfGi9rYsXQSXXTvJbDAPhHLQUojjaNLomdm3cEJ1XTzMqUt3V',
    ];

    // Don't forget the await!
    const trace = await signAndPushTransaction(baseUrl, transaction, privateKeys);

    console.log("Transaction executed");
    console.log("\ntrace:", JSON.stringify(trace, null, 4));
} catch (e) {
    console.log("Caught exception:", e.message);
    if (e.trace)
        console.log(JSON.stringify(e.trace, null, 4));
}
```

## Routing and Virtual Hosts (http)

psinode provides virtual hosting. Domains have 2 categories:

- root domain, e.g. `psibase.127.0.0.1.sslip.io`. This hosts the main page for the chain and also provides service-independent services.
- service domain, e.g. `my-service.psibase.127.0.0.1.sslip.io`. This hosts user interfaces and RPC services for individual services. Services must register for this service.

| Priority    | Domain  | Path       | Description                                                                        |
| ----------- | ------- | ---------- | ---------------------------------------------------------------------------------- |
| 1 (highest) | any     | `/native*` | [Native services](#native-services)                                                |
| 2           | root    | `/common*` | [Common services](#common-services)                                                |
| 3           | root    | `*`        | [Root services](#root-services)                                                    |
| 4           | service | `/common*` | [Common services](#common-services). Registered services only.                     |
| 5 (lowest)  | service | `*`        | [Service-provided services](#service-provided-services). Registered services only. |

The above table describes how psinode normally routes HTTP requests. Only the highest-priority rule is fixed. The [proxy-sys service](default-apps/proxy-sys.md), which handles the remaining routing rules, is customizable, both by distinct networks and by individual infrastructure providers.

### CORS and authorization (http)

psinode always accepts CORS requests, since services would break without it. psinode does not currently handle any HTTP authentication or authorization.

## Native services

psinode's native code handles any target which begins with `/native`, regardless of domain. Targets which begin with `/native` but aren't recognized produce a 404.

### Push transaction (http)

`POST /native/push_transaction` pushes a transaction. The user must pack the transaction using fracpack and pass in the binary as the request body. See [Pack transaction (http)](#pack-transaction-http) for an RPC request which packs transactions. TODO: describe how to pack without using RPC; currently waiting for the transaction format to stabilize, for schema support, and for WASM ABI support.

If the transaction succeeds, or if the transaction fails but a trace is available, then psinode returns a 200 reply with a JSON body (below). If the transaction fails and a trace is not available, then it returns a 500 error with an appropriate message.

```json
{
    "actionTraces": [...],  // Detailed execution information for debugging.
    "error": "..."          // Error message. Field will be empty or missing on success.
    // TODO: events?
}
```

If a transaction succeeds, the transaction may or may not make it into a block. If it makes it into a block, it may get forked back out. TODO: add lifetime tracking and reporting to psinode.

Future psinode versions may trim the action traces when not in a developer mode.

### Boot chain (http)

`POST /native/push_boot` boots the chain. This is only available when psinode does not have a chain yet. Use the `psibase boot` command to boot a chain. TODO: document the body content.

## Common services

The [common-sys service](default-apps/common-sys.md) provides services which start with the `/common*` path across all domains. It handles RPC requests and serves files.

| Method | URL                              | Description                                                                                                              |
| ------ | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `GET`  | `/common/thisservice`            | Returns a JSON string containing the service associated with the domain. If it's the root domain, returns `"common-sys"` |
| `GET`  | `/common/rootdomain`             | Returns a JSON string containing the root domain, e.g. `"psibase.127.0.0.1.sslip.io"`                                    |
| `POST` | `/common/pack/Transaction`       | [Packs a transaction](#pack-transaction-http)                                                                            |
| `POST` | `/common/pack/SignedTransaction` | [Packs a signed transaction](#pack-transaction-http)                                                                     |
| `GET`  | `/common/<other>`                | [Common files (http)](#common-files-http)                                                                                |

### Common files (http)

`common-sys` serves files stored in its tables. Chain operators may add files using the `storeSys` action (`psibase upload`). `psibase boot` installs this default set of files while booting the chain:

| Path                          | Description                                                                                                                                                           |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/common/SimpleUI.mjs`        | Default UI for services under development                                                                                                                             |
| `/common/rpc.mjs`             | [Simple RPC wrappers (js)](#simple-rpc-wrappers-js)<br/>[Conversions (js)](#conversions-js)<br/>[Transactions (js)](#transactions-js)<br/>[Signing (js)](#signing-js) |
| `/common/keyConversions.mjs`  | [Key Conversions (js)](#key-conversions-js)                                                                                                                           |
| `/common/useGraphQLQuery.mjs` | [React GraphQL hooks (js)](#react-graphql-hooks-js)                                                                                                                   |

### rootdomain and siblingUrl (js)

`getRootDomain` calls the `/common/rootdomain/` endpoint, which returns the root domain for the queried node (e.g. `psibase.127.0.0.1.sslip.io`). The result is cached so subsequent calls will not make additional queries to the node.

`siblingUrl` makes it easy for scripts to reference other services' domains. It automatically navigates through reverse proxies, which may change the protocol (e.g. to HTTPS) or port (e.g. to 443) from what psinode provides. `baseUrl` may point within either the root domain or one of the service domains. It also may be empty, null, or undefined for scripts running on webpages served by psinode.

Example uses:

- `siblingUrl(null, '', '/foo/bar')`: Gets URL to `/foo/bar` on the root domain. This form is only usable by scripts running on webpages served by psinode.
- `siblingUrl(null, 'other-service', '/foo/bar')`: Gets URL to `/foo/bar` on the `other-service` domain. This form is only usable by scripts running on webpages served by psinode.
- `siblingUrl('http://psibase.127.0.0.1.sslip.io:8080/', '', '/foo/bar')`: Like above, but usable by scripts running on webpages served outside of psinode.
- `siblingUrl('http://psibase.127.0.0.1.sslip.io:8080/', 'other-service', '/foo/bar')`: Like above, but usable by scripts running on webpages served outside of psinode.

### Pack transaction (http)

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
  "transaction": {},    // This may be the Transaction object (above),
                        // or it may be a hex string containing the packed
                        // transaction.
  "proofs": []          // See Proof
}
```

`Action` has these fields. See [Packing actions (http)](#packing-actions-http).

```
{
  "sender": "...",      // The account name authorizing the action
  "service": "...",     // The service name to receive the action
  "method": "...",      // The method name of the action
  "rawData": "..."      // Hex string containing action data (arguments)
}
```

`Claim` has these fields. See [Signing (js)](#signing-js) to fill claims and proofs.

```
{
  "service": "...",     // The service which verifies the proof meets
                        // the claim, e.g. "verifyec-sys"
  "rawData": "..."      // Hex string containing the claim data.
                        // e.g. `verifyec-sys` expects a public key
                        // in fracpack format.
}
```

`Proof` is a hex string containing data which proves the claim. e.g. `verifyec-sys`
expects a signature in fracpack format. See [Signing (js)](#signing-js) to fill
claims and proofs.

### Simple RPC wrappers (js)

`/common/rpc.mjs` exports a set of utilities to aid interacting with psinode's RPC interface.

| Function or Type                     |       | Description                                                                                                                                                                                        |
| ------------------------------------ | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RPCError`                           |       | Error type. This extends `Error` with a new field, `trace`, which contains the trace returned by [`/native/push_transaction`](#push-transaction-http), if available.                               |
| `throwIfError(response)`             |       | Throw an `RPCError` if the argument (a Response object) indicates a failure. Doesn't fill `trace` since traces are only present with status 200. Returns the argument (Response) if not a failure. |
| `siblingUrl(baseUrl, service, path)` |       | Reexport of `siblingUrl` from [rootdomain and siblingUrl (js)](#rootdomain-and-siblingurl-js).                                                                                                     |
| `get(url)`                           | async | fetch/GET. Returns Response object if ok or throws `RPCError`.                                                                                                                                     |
| `getJson(url)`                       | async | fetch/GET. Returns JSON if ok or throws `RPCError`.                                                                                                                                                |
| `getText(url)`                       | async | fetch/GET. Returns text if ok or throws `RPCError`.                                                                                                                                                |
| `postArrayBuffer(url, data)`         | async | fetch/POST ArrayBuffer. Returns Response object if ok or throws `RPCError`.                                                                                                                        |
| `postArrayBufferGetJson(data)`       | async | fetch/POST ArrayBuffer. Returns JSON if ok or throws `RPCError`.                                                                                                                                   |
| `postGraphQL(url, data)`             | async | fetch/POST GraphQL. Returns Response object if ok or throws `RPCError`.                                                                                                                            |
| `postGraphQLGetJson(data)`           | async | fetch/POST GraphQL. Returns JSON if ok or throws `RPCError`.                                                                                                                                       |
| `postJson(url, data)`                | async | fetch/POST JSON. Returns Response object if ok or throws `RPCError`.                                                                                                                               |
| `postJsonGetArrayBuffer(data)`       | async | fetch/POST JSON. Returns ArrayBuffer if ok or throws `RPCError`.                                                                                                                                   |
| `postJsonGetJson(data)`              | async | fetch/POST JSON. Returns JSON if ok or throws `RPCError`.                                                                                                                                          |
| `postJsonGetText(data)`              | async | fetch/POST JSON. Returns text if ok or throws `RPCError`.                                                                                                                                          |
| `postText(url, data)`                | async | fetch/POST text. Returns Response object if ok or throws `RPCError`.                                                                                                                               |
| `postTextGetJson(data)`              | async | fetch/POST text. Returns JSON if ok or throws `RPCError`.                                                                                                                                          |

### Conversions (js)

`/common/rpc.mjs` exports these conversion functions.

| Function                | Description                            |
| ----------------------- | -------------------------------------- |
| `hexToUint8Array(data)` | Converts a hex string to a Uint8Array. |
| `uint8ArrayToHex(data)` | Converts a Uint8Array to a hex string. |

### Transactions (js)

`/common/rpc.mjs` exports these functions for packing and pushing transactions.

| Function                                       |       | Description                                                                                                                                                                                                                                                                                   |
| ---------------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packAction(baseUrl, action)`                  | async | Packs an action if needed. Returns a new action. An action is an object with fields `sender`, `service`, `method`, and either `data` or `rawData`. If `rawData` is present then it's already packed. Otherwise this function uses [Packing actions (http)](#packing-actions-http) to pack it. |
| `packActions(baseUrl, actions)`                | async | Packs an array of actions.                                                                                                                                                                                                                                                                    |
| `packTransaction(baseUrl, trx)`                | async | Packs a transaction. Also packs any actions within it, if needed. Returns ArrayBuffer if ok or throws `RPCError`. See [Pack transaction (http)](#pack-transaction-http).                                                                                                                      |
| `packSignedTransaction(baseUrl, trx)`          | async | Packs a signed transaction. Returns ArrayBuffer if ok or throws `RPCError`. See [Pack transaction (http)](#pack-transaction-http).                                                                                                                                                            |
| `pushPackedSignedTransaction(baseUrl, packed)` | async | Pushes a packed signed transaction. If the transaction succeeds, then returns the trace. If it fails, throws `RPCError`, including the trace if available. See [Push transaction (http)](#push-transaction-http).                                                                             |
| `packAndPushSignedTransaction(baseUrl, trx)`   | async | Packs then pushes a signed transaction. If the transaction succeeds, then returns the trace. If it fails, throws `RPCError`, including the trace if available.                                                                                                                                |

### Signing (js)

`/common/rpc.mjs` exports these functions for signing and pushing transactions

| Function                                                    |       | Description                                                                                                               |
| ----------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------- |
| `signTransaction(baseUrl, transaction, privateKeys)`        | async | Sign transaction. Returns a new object suitable for passing to `packSignedTransaction` or `packAndPushSignedTransaction`. |
| `signAndPushTransaction(baseUrl, transaction, privateKeys)` | async | Sign, pack, and push transaction.                                                                                         |

`signTransaction` signs a transaction; it also packs any actions if needed.
`baseUrl` must point to within the root domain, one of the service domains,
or be empty or null; see [rootdomain and siblingUrl (js)](#rootdomain-and-siblingurl-js).
`transaction` must have the following form:

```
{
    tapos: {
        refBlockIndex: ...,   // Identifies block
        refBlockSuffix: ...,  // Identifies block
        expiration: "..."     // When transaction expires (UTC)
                              // Example value: "2022-05-31T21:32:23Z"
                              // Use `new Date(...)` to generate the correct format.
    },
    actions: [],        // See below
}
```

`Action` has these fields:

```
{
  sender: "...",    // The account name authorizing the action
  service: "...",   // The service name to receive the action
  method: "...",    // The method name of the action

  data: {...},      // Method's arguments. Not needed if `rawData` is present.
  rawData: "...",   // Hex string containing packed arguments. Not needed if `data` is present.
}
```

`privateKeys` is an array which may contain a mix of:

- Private keys in text form, e.g. `"PVT_K1_2bfGi9r..."`
- `{keyType, keyPair}`. See [Key Conversions (js)](#key-conversions-js).

### Key Conversions (js)

`/common/keyConversions.mjs` exports functions which convert
[Elliptic KeyPair objects](https://github.com/indutny/elliptic) and Elliptic
Signature objects to and from psibase's text and fracpack forms. Each function
accepts or returns a `{keyType, keyPair}` or `{keyType, signature}`, where
keyType is one of the following values:

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

| Function                                      | Description                                                                        |
| --------------------------------------------- | ---------------------------------------------------------------------------------- |
| `privateStringToKeyPair(s)`                   | Convert a private key in string form to `{keyType, keyPair}`                       |
| `publicStringToKeyPair(s)`                    | Convert a public key in string form to `{keyType, keyPair}`                        |
| `privateKeyPairToString({keyType, keyPair})`  | Convert the private key in `{keyType, keyPair}` to a string                        |
| `publicKeyPairToString({keyType, keyPair})`   | Convert the public key in `{keyType, keyPair}` to a string                         |
| `publicKeyPairToFracpack({keyType, keyPair})` | Convert the public key in `{keyType, keyPair}` to fracpack format in a Uint8Array  |
| `signatureToFracpack({keyType, signature})`   | Convert the signature in `{keyType, signature}` to fracpack format in a Uint8Array |

### React GraphQL hooks (js)

TODO

## Root services

TODO

## Service-provided services

TODO

### Packing actions (http)

TODO

