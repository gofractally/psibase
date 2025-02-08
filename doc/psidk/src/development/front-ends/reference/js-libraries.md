# JS libraries

Currently psibase hosts multiple JavaScript modules in the `/common/` service tables. Currently, these libraries can only be used by dynamically importing them into your app. In the future, a package may be hosted on a registry to allow you to bundle the library with your application for better type safety and autocomplete.

## RPC wrappers

`/common/common-lib.js` exports a set of utilities to aid interacting with psinode's RPC interface.

| Function or Type                     |       | Description                                                                                                                                                                                        |
| ------------------------------------ | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RPCError`                           |       | Error type. This extends `Error` with a new field, `trace`, which contains the trace returned by [push_transaction](../../../default-apps/transact.md#push-transaction), if available.                               |
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

## Conversions

`/common/common-lib.js` exports these conversion functions.

| Function                | Description                            |
| ----------------------- | -------------------------------------- |
| `hexToUint8Array(data)` | Converts a hex string to a Uint8Array. |
| `uint8ArrayToHex(data)` | Converts a Uint8Array to a hex string. |

## Transactions

`/common/common-lib.js` exports these functions for packing and pushing transactions.

| Function                                       |       | Description                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packAction(baseUrl, action)`                  | async | Packs an action if needed. Returns a new action. An action is an object with fields `sender`, `service`, `method`, and either `data` or `rawData`. If `rawData` is present then it's already packed. Otherwise this function uses [Packing actions](./http-requests.md#pack-action) to pack it. |
| `packActions(baseUrl, actions)`                | async | Packs an array of actions.                                                                                                                                                                                                                                                                      |
| `packTransaction(baseUrl, trx)`                | async | Packs a transaction. Also packs any actions within it, if needed. Returns ArrayBuffer if ok or throws `RPCError`. See [Pack transaction](./http-requests.md#pack-transaction).                                                                                                                  |
| `packSignedTransaction(baseUrl, trx)`          | async | Packs a signed transaction. Returns ArrayBuffer if ok or throws `RPCError`. See [Pack transaction](./http-requests.md#pack-transaction).                                                                                                                                                        |
| `pushPackedSignedTransaction(baseUrl, packed)` | async | Pushes a packed signed transaction. If the transaction succeeds, then returns the trace. If it fails, throws `RPCError`, including the trace if available. See [Push transaction](./http-requests.md#push-transaction).                                                                         |
| `packAndPushSignedTransaction(baseUrl, trx)`   | async | Packs then pushes a signed transaction. If the transaction succeeds, then returns the trace. If it fails, throws `RPCError`, including the trace if available.                                                                                                                                  |

## Signing

`/common/common-lib.js` exports these functions for signing and pushing transactions

| Function                                                    |       | Description                                                                                                               |
| ----------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------- |
| `signTransaction(baseUrl, transaction, privateKeys)`        | async | Sign transaction. Returns a new object suitable for passing to `packSignedTransaction` or `packAndPushSignedTransaction`. |
| `signAndPushTransaction(baseUrl, transaction, privateKeys)` | async | Sign, pack, and push transaction.                                                                                         |

`signTransaction` signs a transaction; it also packs any actions if needed.
`baseUrl` must point to within the root domain, one of the service domains, or be empty or null; see [rootdomain and siblingUrl (js)](#rootdomain-and-siblingurl-js).
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

## Service utilities

`/common/common-lib.js` exports these utility functions:

| Function                                       |       | Description                                                                                                               |
| ---------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------- |
| `getRootDomain`                                | async | returns the root domain for the queried node (e.g. `psibase.127.0.0.1.sslip.io`). |
| `siblingUrlsiblingUrl(baseUrl, service, path)` | async | Sign, pack, and push transaction.                                                                                         |


`getRootDomain` calls the `/common/rootdomain/` endpoint, and the result is cached so subsequent calls will not make additional queries to the node.

`siblingUrl` makes it easy for scripts to reference other services' domains. It automatically navigates through reverse proxies, which may change the protocol (e.g. to HTTPS) or port (e.g. to 443) from what psinode provides. 
 * `baseUrl` may point within either the root domain or one of the service domains. It also may be empty, null, or undefined for scripts running on webpages served by psinode.

Example uses:

- `siblingUrl(null, '', '/foo/bar')`: Gets URL to `/foo/bar` on the root domain. This form is only usable by scripts running on webpages served by psinode.
- `siblingUrl(null, 'other-service', '/foo/bar')`: Gets URL to `/foo/bar` on the `other-service` domain. This form is only usable by scripts running on webpages served by psinode.
- `siblingUrl('http://psibase.127.0.0.1.sslip.io:8080/', '', '/foo/bar')`: Like above, but usable by scripts running on webpages served outside of psinode.
- `siblingUrl('http://psibase.127.0.0.1.sslip.io:8080/', 'other-service', '/foo/bar')`: Like above, but usable by scripts running on webpages served outside of psinode.

## Key Conversions

`/common/common-lib.js` exports functions which convert [Elliptic KeyPair objects](https://github.com/indutny/elliptic) and Elliptic Signature objects to and from psibase's text and fracpack forms. 

| Function                                      | Description                                                                        |
| --------------------------------------------- | ---------------------------------------------------------------------------------- |
| `privateStringToKeyPair(s)`                   | Convert a private key in string form to `{keyType, keyPair}`                       |
| `publicStringToKeyPair(s)`                    | Convert a public key in string form to `{keyType, keyPair}`                        |
| `privateKeyPairToString({keyType, keyPair})`  | Convert the private key in `{keyType, keyPair}` to a string                        |
| `publicKeyPairToString({keyType, keyPair})`   | Convert the public key in `{keyType, keyPair}` to a string                         |
| `publicKeyPairToFracpack({keyType, keyPair})` | Convert the public key in `{keyType, keyPair}` to fracpack format in a Uint8Array  |
| `signatureToFracpack({keyType, signature})`   | Convert the signature in `{keyType, signature}` to fracpack format in a Uint8Array |

Each function accepts or returns a `{keyType, keyPair}` or `{keyType, signature}`, where `keyType` is one of the following values:

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

The default auth app [auth-sig](../../../default-apps/auth-sig.md) accepts K1 or R1 keys.

## React GraphQL hooks (js)

> ➕ TODO
