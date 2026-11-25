# common-api

## Common endpoints

The common-api service endpoints start with the `/common/*` path across all domains. It handles RPC requests and serves files.

| Method | URL                              | Description                                                                                                            |
|--------|----------------------------------|------------------------------------------------------------------------------------------------------------------------|
| `GET`  | `/common/chainid`                | Returns the unique identifier for the chain (Chain ID)                                                                 |
| `GET`  | `/common/tapos/head`             | Returns [TaPoS](#tapos) for the current head block                                                                     |
| `GET`  | `/common/thisservice`            | Returns a JSON string containing the service associated with the domain. If it's the root domain, returns `"homepage"` |
| `GET`  | `/common/rootdomain`             | Returns a JSON string containing the root domain, e.g. `"psibase.localhost"`                                           |
| `POST` | `/common/pack/Transaction`       | [Packs a transaction](#pack-transaction)                                                                               |
| `POST` | `/common/pack/SignedTransaction` | [Packs a signed transaction](#pack-signed-transaction)                                                                 |
| `GET`  | `/common/<other>`                | [Common files](#common-files)                                                                                          |

### Tapos

`GET /common/tapos/head` returns the TaPoS information for the current head block. To learn more about TaPoS and its purpose, see the the [specification document](../specifications/blockchain/tapos.md).

The TaPoS information returned from this endpoint has these fields:
```json
{
  "refBlockIndex": ...,   // Identifies block
  "refBlockSuffix": ...   // Identifies block
}
```

TaPoS must be attached to every transaction submitted to a psibase network. In addition to the `refBlockIndex` and `refBlockSuffix`, TaPoS information in a transaction requires an additional `expiration` field identifying a time after which the transaction is considered expired and can no longer be applied.

### Pack transaction

`POST /common/pack/Transaction` and `POST /common/pack/SignedTransaction` use [PSSZ](https://github.com/gofractally/psio/blob/main/docs/pssz-spec.md) to convert unsigned and signed transactions to binary. They accept JSON as input and return the binary data.

`Transaction` has these fields:
```json
{
  "tapos": {                // See [tapos](#tapos)
    "refBlockIndex": ...,   // Identifies block
    "refBlockSuffix": ...,  // Identifies block
    "expiration": "...",    // When transaction expires (UTC), in whole seconds
                            // Example value: "2022-05-31T21:32:23Z"
    "flags": 0              // Required
  },
  "actions": [],            // See Action
  "claims": []              // See Claim
}
```

`SignedTransaction` has these fields:
```json
{
  "transaction": {},    // The Transaction object (above)
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
                        // the claim, e.g. "verify-k1"
  "rawData": "..."      // Hex string containing the claim data.
                        // e.g. `verify-k1` expects a public key
                        // (the DER bytes of a SubjectPublicKeyInfo).
}
```

Each kind of key has its own verifier service, and a claim for a key must name the verifier for that key's kind: `verify-k1` for secp256k1 keys and `verify-r1` for secp256r1 (P-256) keys. `signTransaction` and the `verifierFor` function of the common library choose it from the key.

`Proof` is a hex string containing data which proves the claim. e.g. `verify-k1` expects a signature (64 bytes, `r || s`, low-S). See [Signing (js)](#signing-js) to fill claims and proofs.

### Pack signed transaction

> ➕ TODO

### Common files

There are special rules in the standard psibase HTTP server that allow for common files to be accessed at a special path on any subdomain. Any files added to the `common-api` subdomain by the infrastructure providers can be served from any subdomain through this mechanism.

Default common files:

| Path                          | Description                                                                                                                                                                                                                                                                                                                                                                                                                           |
|-------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `/common/SimpleUI.mjs`        | Default UI for services under development ([Learn more](../development/services/cpp-service/minimal-ui/))                                                                                                                                                                                                                                                                                                                             |
| `/common/common-lib.js`       | [Simple RPC wrappers](../development/front-ends/reference/js-libraries.md#rpc-wrappers)<br/>[Conversions](../development/front-ends/reference/js-libraries.md#conversions)<br/>[Transactions](../development/front-ends/reference/js-libraries.md#transactions)<br/>[Signing](../development/front-ends/reference/js-libraries.md#signing)<br/>[Key Conversions](../development/front-ends/reference/js-libraries.md#key-conversions) |
| `/common/useGraphQLQuery.mjs` | [React GraphQL hooks](../development/front-ends/reference/js-libraries.md#react-graphql-hooks-js)                                                                                                                                                                                                                                                                                                                                     |
