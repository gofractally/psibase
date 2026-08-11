# x-admin

The adminstrator service provides tools for monitoring and controlling the server.

## Authentication

Access to `x-admin` is allowed only if
- The client and all proxies are either running over the loopback interface (localhost) or have IP addresses listed in the environmental variable `PSIBASE_ADMIN_IP`, which holds a comma separated list of IP addresses, or
- The user is logged in as an authorized on-chain account, or
- The proxy that is directly connected to psinode is authorized and the request includes the header configured in the environmental variable `PSIBASE_USERNAME_FIELD`, or
- [HTTP Basic Authentication](x-basic.md) is configured, and the request included valid credentials

## Configuration Options

All of these options can also be specified on the command line or in the server's config file. Changes applied through the web API will be saved to the config file and will be remembered across server restarts. Except where noted otherwise, a new configuration takes effect when saved.

### Block Producer Name

The name that the server uses to produce blocks. It must be a valid [account name](../development/services/cpp-service/reference/magic-numbers.md#psibaseaccountnumber). The node will only produce blocks when its producer name is one of the currently active producers specified by the chain. To disable block production, the producer name can be left blank.

### Host

The root host name for services. If it is empty, the HTTP API will not be usable.

### Port

The TCP port on which the server listens. The server must be restarted for a change to the port to take effect.

### Logger

See [Logging](x-admin/http-endpoints.md#logging) for a list of the available logger types and their parameters.

### Accept all incoming P2P connections

If enabled, the node accepts incoming P2P connections from any peer. If disabled, incoming connections are accepted only from accounts listed under [Allowed peers](#allowed-peers). With the option disabled and an empty allow list, no incoming P2P connections are accepted.

### Allowed peers

A whitelist of on-chain accounts that may open an incoming P2P connection when [Accept all incoming P2P connections](#accept-all-incoming-p2p-connections) is disabled. The list has no effect while that option is enabled, because all incoming peers are already accepted.
