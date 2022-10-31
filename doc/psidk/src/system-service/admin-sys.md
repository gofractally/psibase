# admin-sys

The adminstrator service is hosted at [http://localhost:8080/](http://localhost:8080/) as a [Builtin Service](#builtin-services). It provides tools for monitoring and controlling the server.

## Configuration Options

All of these options can also be specified on the command line or in the server's config file. Changes applied through the web API will be saved to the config file and will be remembered across server restarts. Except where noted otherwise, a new configuration takes effect when saved.

### Accept incoming P2P connections

If enabled, the node will accept p2p connections at the websocket endpoint `/native/p2p`.

### Block Producer Name

The name that the server uses to produce blocks. It must be a valid [account name](../cpp-service/reference/magic-numbers.html#psibaseaccountnumber). The node will only produce blocks when its producer name is one of the currently active producers specified by the chain. To disable block production, the producer name can be left blank.

### Host

The root host name for services. If it is empty, only builtin services will be available.

### Port

The TCP port on which the server listens. The server must be restarted for a change to the port to take effect.

### Logger

See [Logging](../psibase/logging.md) for a list of the available logger types and their parameters.

### Builtin Services

`psinode` will serve content directly from the filesystem when the request's host matches the host of a builtin service. A builtin service hides a chain service with the same name.

Builtin services have significant limitations. On-chain services should be preferred unless the service requires access to the admin API (the administrator service) or needs to be available before the chain is booted.

Builtin services can only serve the following files types:
- `.html`
- `.svg`
- `.js`
- `.mjs`
- `.css`
- `.ttf`

### Access to admin API

This option controls access to the [HTTP API](../http.md#node-administrator-services) under `/native/admin`, which is used by the administrator service. The admin API must be restricted to services trusted by the node operator, because it can tell `psinode` to read or write any file.

- Builtin services only: Allows builtin services to access the admin API. This is the default and should rarely need to be changed.
- All services: Allows any service to access the admin API. This should only be used for trusted private chains.
- Disabled: The admin API will not be available. Configuration changes can only be made via the command line and config file, which require a server restart. Disabling the admin API will disconnect the administrator service.
