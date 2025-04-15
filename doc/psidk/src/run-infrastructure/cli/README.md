# Psinode and Psibase

psidk comes with two executables for working with chains:

- [psinode](psinode.md) runs a chain. It can optionally be a producer or a non-producer node on a chain. It also optionally hosts an http interface which provides RPC services, GraphQL services, and hosts web UIs. On-chain services define most of the http interface.
- [psibase](psibase.md) is a command-line client for interacting with the chain. It connects to the http interface on a running node.

## Booting a chain

A chain doesn't exist until it's booted. This procedure boots a chain suitable for local development.

### Start psinode

```
psinode -p prod my_psinode_db
```

This will:

- Open a database named `my_psinode_db` in the current directory; it will create it if it does not already exist.
- Host a web UI and an RPC interface at the default hostname and port, `http://psibase.localhost:8080/`.
- Produce blocks once the chain is booted.

### Boot the chain

Interacting with the node can now be done either through the psibase cli tool, or graphically through the [x-admin app](../../default-apps/x-admin.md).

In a separate terminal, while `psinode` is running, run the following:

```
psibase boot -p prod
```

This will create a new chain which has:

- A set of system services suitable for development
- A set of web-based user interfaces suitable for development
- `prod` as the sole block producer

`psibase boot` creates system accounts with no authentication, making it easy to manage them. If you intend to make the chain public, use boot's `-k` or `--account-key` option to set the public key for those accounts.

You may now interact with the chain using:

- The web UI at `http://psibase.localhost:8080/`
- Additional psibase commands

## Connecting to an existing chain

```
psinode \
    --peer some_domain_or_ip:8080 \
    --listen 8080                 \
    --host psibase.localhost      \
    my_psinode_db
```

This will:

- Open a database named `my_psinode_db` in the current directory; it will create it if it does not already exist.
- Host a web UI and an RPC interface at `http://psibase.localhost:8080/`.
- Connect to a peer at `some_domain_or_ip:8080`. The peer option may be repeated multiple times to connect to multiple peers.

If the database is currently empty, or if the database is on the same chain as the peers, this will grab blocks from the peers and replay them. Any peers must have their `--p2p` option enabled.

## Cloning a node

psinode's database is portable between machines. Copying the database may be faster than replaying from a block file. Be sure to shut down a node before copying its database to prevent corruption.

## SIGANY

`psinode` uses `triedent` as its database. triedent locks a large amount of space in memory-mapped files, plus psinode reserves a lot of memory for executing many WASMs simultaneously. This makes psinode a tempting target for Linux's out-of-memory (OOM) killer, which strikes suddenly with `SIGKILL`. Triedent works to make its database robust against this, but not against kernel crashes, filesystem corruption, or power outages. If the OOM killer strikes, psinode's database should survive. If your machine loses power, or you use a remote filesystem, remote block store, or distributed block store, then psinode's database is vulnerable to undetectable corruption. Be especially cautious about using Kubernetes; it has a nasty habit of yanking volumes before the kernel has finished flushing a stopped container's memory-mapped files, causing corruption.

Since it's near-impossible to do SIGKILL coverage testing, we're going with a more aggressive option for now. During beta, psinode doesn't gracefully shutdown for SIGINT or SIGHUP. Instead, these kill psinode as aggressively as SIGKILL does. There may be a delay. This isn't psinode cleaning after itself; this is the kernel saving psinode's memory-mapped files.
