# x-admin

The adminstrator service provides tools for monitoring and controlling the server.

## Authentication

Access to `x-admin` is allowed only if
- The client and all proxies are either running over the loopback interface (localhost) or have IP addresses listed in the environmental variable `PSIBASE_ADMIN_IP`, which holds a comma separated list of IP addresses, or
- The user is logged in as an authorized on-chain account, or
- The proxy that is directly connected to psinode is authorized and the request includes the header configured in the environmental variable `PSIBASE_USERNAME_FIELD`

## Configuration Options

All of these options can also be specified on the command line or in the server's config file. Changes applied through the web API will be saved to the config file and will be remembered across server restarts. Except where noted otherwise, a new configuration takes effect when saved.

### Accept incoming P2P connections

If enabled, the node will accept p2p connections from other nodes.

### Block Producer Name

The name that the server uses to produce blocks. It must be a valid [account name](../development/services/cpp-service/reference/magic-numbers.md#psibaseaccountnumber). The node will only produce blocks when its producer name is one of the currently active producers specified by the chain. To disable block production, the producer name can be left blank.

### Host

The root host name for services. If it is empty, the HTTP API will not be usable.

### Port

The TCP port on which the server listens. The server must be restarted for a change to the port to take effect.

### Logger

See [Logging](../run-infrastructure/configuration/logging.md) for a list of the available logger types and their parameters.

## HTTP Endpoints

| Method   | URL               | Description                                                                                                                                                      |
|----------|-------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `GET`    | `/services/*`     | Returns the wasm for a subjective service                                                                                                                        |
| `PUT`    | `/services/*`     | Sets the wasm for a subjective service                                                                                                                           |
| `GET`    | `/admin_accounts` | Returns a JSON list of all on-chain accounts that are authorized to administer the node                                                                          |
| `POST`   | `/admin_accounts` | Takes a JSON object of the form `{"account": String, "admin": bool}` and either adds or removes the account from the set of administrator accounts for the node. |
| `GET`    | `/admin_login`    | Returns a token to authenticate as `x-admin` to other services.                                                                                                  |
| `GET`    | `*`               | Returns static content                                                                                                                                           |
| `PUT`    | `*`               | Uploads static content                                                                                                                                           |
| `DELETE` | `*`               | Removes static content                                                                                                                                           |

## Service

{{#cpp-doc ::LocalService::XAdmin}}
