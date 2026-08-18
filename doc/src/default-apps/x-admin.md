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

### Incoming connection policy

The `p2p` config option (`--p2p`). Also editable on the Peers page under Settings. Chooses who may open a P2P connection to this node:

- **Accept all incoming P2P connections** — any peer may connect (`p2p` enabled).
- **Accept incoming P2P connections from whitelisted accounts only** — only accounts listed under [Allowed peers](#allowed-peers) may connect (`p2p` disabled). With an empty allow list, no incoming P2P connections are accepted.

## Peering

Peer connections and the incoming allow list are managed on the Peers page (and via [x-peers](x-peers.md)).

### Allowed peers

A whitelist of on-chain accounts that may open an incoming P2P connection when [Incoming connection policy](#incoming-connection-policy) is set to accept whitelisted accounts only. The list is unused while the policy accepts all incoming connections. It is stored by [x-peers](x-peers.md) and is not part of the server config file.
