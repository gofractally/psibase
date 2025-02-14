# transact

## HTTP Endpoints

### Push transaction

`POST /push_transaction` pushes a transaction. The user must pack the transaction using fracpack and pass in the binary as the request body. See [Pack transaction](../development/front-ends/reference/http-requests.md#pack-transaction) for an RPC request which packs transactions. The `Content-Type` of the request body should be `application/octet-stream`.

If the transaction succeeds, or if the transaction fails but a trace is available, then psinode returns a 200 reply with a JSON body (below). If the transaction fails and a trace is not available, then it returns a 500 error with an appropriate message. The trace can be returned either as JSON (`application/json`) or fracpack (`application/octet-stream`). The `Accept` header can be used to choose a representation.

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

### Login

`POST /login` takes a packed transaction with a single action of the form `user => service::loginSys(root host)`. The transaction must have the `do_not_broadcast_flag` set. The action will not be executed and does not need to exist on the target service. The response is JSON containing a bearer token that can be used for requests to the specified service.

| Field        | Type   | Notes     |
|--------------|--------|-----------|
| access_token | String | The token |
| token_type   | String | "bearer"  |

The token can be submitted either in an `Authorization` header or in a cookie named `__Host-SESSION`.

{{#cpp-doc ::SystemService::Transact}}
{{#cpp-doc ::SystemService::ServiceMethod}}
{{#cpp-doc ::SystemService::AuthInterface}}
