# Administration

Much of the administration of an individual node can be done via the graphical user interface provided at `x-admin.your-host.com`, where `your-host` is the public address of your psibase infrastructure node (e.g. psibase.localhost:8080 for local nodes). To learn more about the administration app, see the documentation on [x-admin](../default-apps/x-admin.md). For more complex administration requirements, psinode exposes many services and configuration options over an http interface.

## Starting psinode

```sh
psinode my_psinode_db
```

This will:

- Open a database in the `my_psinode_db` directory; it will create it if it does not already exist.
- Host a web UI and an RPC interface at the default hostname and port, `http://psibase.localhost:8080/`.

## Booting a network

Booting a network is only a valid operation if psinode does not yet have any chain. It can be done either with the [`psibase`](./cli/psibase.md#boot) CLI tool, or by using the GUI provided by the [x-admin](../default-apps/x-admin.md) service.

## Peering with others

`psinode` can be configured to connect to other nodes [on the command line](./cli/psinode.md#p2p-network-options) or by using the GUI provided by the [x-admin](../default-apps/x-admin.md) service.
