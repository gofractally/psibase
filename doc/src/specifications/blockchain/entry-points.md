# Entry points

All entry points must be WASM exports with type `(func (param) (result))`. The service should use `getCurrentAction` to get an `Action` containing the arguments. The `sender` and `method` fields are both set to `0`. The result (if any) should be returned with `setRetval`. Both the arguments and result use [fracpack](../data-formats/fracpack.md) encoding.

Each entry point starts a fresh transaction context. Modules will be instantiated on their first use within the context.

## transact::processTransaction

`processTransaction` applies a transaction to the chain. It should be defined as a WASM export. Only subjective services can access subjective databases. Objective databases are readable and writable.

| Argument              | Type       | Description                                                                                                                                                    |
|-----------------------|------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------|
| transaction           | byte array | A packed `Transaction`                                                                                                                                         |
| checkFirstAuthAndExit | bool       | If true, instead of applying the transaction, check the authorization of the account to be billed for this transaction. This mode must not write the database. |

Any result is ignored

## transact::nextTransaction

`nextTransaction` returns the next transaction to apply when producing a block. It should be defined as a WASM export. All services can access subjective databases. Objective databases are not writable.

The result is an `Option<SignedTransaction>`. An empty result indicates that no transactions are ready to apply.

## http-server::serve

`serve` is called to handle HTTP requests from the server. It should be defined as a WASM export. All databases are readable by all services. Only fork-independent databases are writable.

| Argument | Type          | Description                              |
|----------|---------------|------------------------------------------|
| socket   | `i32`         | The socket on which to send the response |
| request  | `HttpRequest` |                                          |

`serve` should call `socketSend` to send the response. To send

The socket is initially owned by the `serve` context. If `serve` returns or aborts without sending a response or yielding ownership with `socketSetAutoClose`, a 500 response will be returned.

## http-server::recv

`recv` is called when a message is received on a socket. It should be defined as a WASM export. All databases are readable by all services. Only fork-independent databases are writable.

| Argument | Type        | Description                                                                     |
|----------|-------------|---------------------------------------------------------------------------------|
| socket   | `i32`       | The socket that the message came from                                           |
| data     | byte vector | The raw bytes of the message. The interpretation depends on the type of socket. |

## verify

Any service that provides signature verification defines `verify`. It should be defined as a WASM export. The database is not accessible.

| Argument        | Type         | Description                 |
|-----------------|--------------|-----------------------------|
| transactionHash | `Checksum25` | The hash of the transaction |
| claim           | `Claim`      | The public key              |
| proof           | byte vector  | The transaction signature   |

`verify` should return normally if the signature is valid or abort if the signature is invalid. Any return value is ignored.

## Notifications

Notifications are registered in the native `notifyTable`. Unlike other entry points, they are executed as regular actions though the `called` export.
