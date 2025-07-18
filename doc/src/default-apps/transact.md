# transact

## HTTP Endpoints

### Push transaction

`POST /push_transaction` pushes a transaction. The user must pack the transaction using fracpack and pass in the binary as the request body. See [Pack transaction](../development/front-ends/reference/http-requests.md#pack-transaction) for an RPC request which packs transactions. The `Content-Type` of the request body should be `application/octet-stream`.

#### Http response timing

The `/push_transaction` endpoint accepts a `wait_for` query parameter with two options:

- `final` (default): Returns a 200 response only after the transaction is included in an irreversible block. For failed transactions with traces, waits until expiration. This ensures finality but increases response time.

- `applied`: Returns immediately after transaction execution, regardless of whether it succeeds or fails. The transaction may still be forked out or included in a block later. Returns a 500 error if a failed transaction has no trace available.

#### Http response encoding

The trace can be returned either as JSON (`application/json`) or fracpack (`application/octet-stream`). The `Accept` header can be used to choose a representation.

```json
{
    "actionTraces": [...],  // Detailed execution information for debugging.
    "error": "..."          // Error message. Field will be empty or missing on success.
    // TODO: events?
}
```

> ➕ TODO: add lifetime tracking and reporting to psinode.

Future psinode versions may trim the action traces when not in a developer mode.

### Login

`POST /login` takes a packed transaction with a single action of the form `user => service::loginSys(root host)`. The transaction must have the `do_not_broadcast_flag` set. The action will not be executed and does not need to exist on the target service. The response is JSON containing a bearer token that can be used for query requests.

| Field        | Type   | Notes     |
| ------------ | ------ | --------- |
| access_token | String | The token |
| token_type   | String | "bearer"  |

The token can be submitted either in an `Authorization` header or in a cookie named `__Host-SESSION`.

{{#cpp-doc ::SystemService::Transact}}
{{#cpp-doc ::SystemService::ServiceMethod}}
{{#cpp-doc ::SystemService::AuthInterface}}
