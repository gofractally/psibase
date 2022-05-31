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

psinode always accepts CORS requests, since services would break without it. psinode does not currently handle any HTTP authentication or authorization.

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

The [common-sys contract](system-contract/common-sys.md) provides services which start with the `/common*` path across all domains. It handles RPC requests and serves files.

| request                               | description                                                                                                               |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `GET /common/thiscontract`            | Returns a JSON string containing the contract associated with the domain. If it's the root domain, returns `"common-sys"` |
| `GET /common/rootdomain`              | Returns a JSON string containing the root domain, e.g. `"psibase.127.0.0.1.sslip.io"`                                     |
| `GET /common/rootdomain.js`           | See below.                                                                                                                |
| `GET /common/rootdomain.mjs`          | See below.                                                                                                                |
| `POST /common/pack/SignedTransaction` | [Packs a transaction](#pack-transaction)                                                                                  |
| `GET /common/<other>`                 | [Common files](#common-files)                                                                                             |

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

- `siblingUrl('', '/foo/bar')`: URL to `/foo/bar` on the root domain
- `siblingUrl('other-contract', '/foo/bar')`: URL to `/foo/bar` on the `other-contract` domain

### Pack transaction

### Common files

`common-sys` serves files stored in its tables. Chain operators may add files using the `storeSys` action. `psibase boot` installs the following files:

| path                          | description                                 |
| ----------------------------- | ------------------------------------------- |
| `/common/SimpleUI.mjs`        | Default UI for contracts under development  |
| `/common/rpc.mjs`             | [RPC helpers](#rpc-helpers)                 |
| `/common/useGraphQLQuery.mjs` | [React GraphQL hooks](#react-graphql-hooks) |

### RPC helpers

### React GraphQL hooks

## Root services

## Contract-provided services
