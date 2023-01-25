# Psinode and Psibase

psidk comes with two executables for working with chains:

- `psinode` runs a chain. It can optionally be a producer or a non-producer node on a chain. It also optionally hosts an http interface which provides RPC services, GraphQL services, and hosts web UIs. On-chain services define most of the http interface.
- `psibase` is a command-line client for interacting with the chain. It connects to the http interface on a running node.

## psinode

`psinode` has the following command-line interface:

```
psinode [OPTIONS] <DATABASE>
```

`<DATABASE>`, which is required, is a path to the psibase database. psinode creates it if it does not already exist.

If you don't give it any other options, psinode will find that it has nothing to do and immediately shut down. There are four important options for creating and running a local test chain:

- `--listen` tells psinode an interface and TCP port to listen on. If this argument is not provided, the HTTP server will not run. The argument can be any of the following
  - A port number: Listens on `0.0.0.0` with the specified port
  - An IP address: Listen on port 80 on the given interface
  - An IP address and port separated by a colon: `ipv4:port` or `[ipv6]:port`
  - An `http` or `https` URL: The host component must be an IP address. All components other than the host and port must be empty. `https` requires `--tls-cert` and `--tls-key` to be provided.
  - A filesystem path: Listens on a local socket
- `-p` or `--producer` tells psinode to produce blocks. It will not start production on an empty chain until you boot the chain (below). Its argument is a name for the producer. psinode will only produce blocks when it is this producer's turn according to consensus. Multiple distinct nodes must not use the same producer name.
- `-o` or `--host` tells psinode to host the http interface. Its argument is a domain name which supports virtual hosting. e.g. if it's running on your local machine, use `psibase.127.0.0.1.sslip.io`. This argument allows on-chain services to handle HTTP requests and also allows the node to accept transactions.
- `-k` or `--key` tells psinode a private key with which to sign blocks. Any number of keys may be provided, but only the one that matches the public key corresponding to the producer name will be used. If the correct key is not provided, then `psinode` will be unable to produce blocks.

Three more options are important for connecting multiple nodes together in a network:

- `--p2p` tells psinode to allow external nodes to peer to it over its http interface at `/native/p2p`.
- `--peer` tells psinode a peer to sync with. The argument should have the form `host:port`. This argument can appear any number of times.
- `--autoconnect` limits the number of out-going peer connections. If it is less than the number of `--peer` options, the later peers will be tried after a connection to an earlier peer fails.

Options controlling native content (enabled in new nodes by default):

- `--service` *host*:*path*: tells psinode to host static content from *path*.
- `--admin` `'builtin:*'` | `'*'` | *service*: tells psinode to enable the [admin API](../http.md#node-administrator-services)

Options controlling TLS:
- `--tls-cert` *file*: A file containing the certificate chain that the server will use. The key must be specified as well using `--tls-key`. This certificate will be used both as a server certificate for incoming https connections and as a client certificate for outing p2p connections using https. The certificate should be a wildcard certificate, valid for both *host* and \*.*host*.
- `--tls-key` *file*: The private key corresponding to `--tls-cert`
- `--tls-trustfile` *file*: This file should contain trusted root certification authorities used to verify certificates. If it is not provided a system dependent default will be used.

Options can also be specified in a configuration file loaded from `<DATABASE>/config`. If an option is specified on both the command line and the config file, the command line takes precedence. When a new database is created, it will be initialized with a default configuration file that includes the [administrator service](../system-service/admin-sys.md).

The configuration file also controls [logging](logging.md).

Example:
```ini
producer = prod
host     = 127.0.0.1.sslip.io
listen   = 8080
service  = localhost:$PREFIX/share/psibase/services/admin-sys
admin    = builtin:*

[logger.stderr]
type   = console
filter = Severity >= info
format = [{TimeStamp}] {Message}
```

## psibase

`psibase` provides commands for booting a chain, creating accounts, deploying services, and more. Notable options and commands for service development:

- `-a` or `--api` tells it which api endpoint to connect to. This defaults to `http://psibase.127.0.0.1.sslip.io:8080/`.
- `boot` boots an empty chain; see below
- `deploy` deploys a service; see [Basic Service](../cpp-service/basic/)

## Booting a chain

A chain doesn't exist until it's booted. This procedure boots a chain suitable for local development.

### Start psinode

```
psinode -p prod -o psibase.127.0.0.1.sslip.io my_psinode_db --listen 8080
```

This will:

- Open a database named `my_psinode_db` in the current directory; it will create it if it does not already exist.
- Host a web UI and an RPC interface at [http://psibase.127.0.0.1.sslip.io:8080/](http://psibase.127.0.0.1.sslip.io:8080/).
- Produce blocks once the chain is booted.

### Boot the chain

In a separate terminal, while `psinode` is running, run the following:

```
psibase boot -p prod
```

This will create a new chain which has:

- A set of system services suitable for development
- A set of web-based user interfaces suitable for development
- `prod` as the sole block producer

`psibase boot` creates system accounts with no authentication, making it easy to manage them. If you intend to make the chain public, use boot's `-k` or `--key` option to set the public key for those accounts.

You may now interact with the chain using:

- The web UI at [http://psibase.127.0.0.1.sslip.io:8080/](http://psibase.127.0.0.1.sslip.io:8080/)
- Additional psibase commands

## Connecting to an existing chain

```
psinode \
    --peer some_domain_or_ip:8080 \
    --listen 8080                 \
    -o psibase.127.0.0.1.sslip.io \
    my_psinode_db
```

This will:

- Open a database named `my_psinode_db` in the current directory; it will create it if it does not already exist.
- Host a web UI and an RPC interface at [http://psibase.127.0.0.1.sslip.io:8080/](http://psibase.127.0.0.1.sslip.io:8080/).
- Connect to a peer at `some_domain_or_ip:8080`. The peer option may be repeated multiple times to connect to multiple peers.

If the database is currently empty, or if the database is on the same chain as the peers, this will grab blocks from the peers and replay them. Any peers must have their `--p2p` option enabled.

## Cloning a node

psinode's database is portable between machines. Copying the database may be faster than replaying from a block file. Be sure to shut down a node before copying its database to prevent corruption.

## SIGANY

`psinode` uses `triedent` as its database. triedent locks a large amount of space in memory-mapped files, plus psinode reserves a lot of memory for executing many WASMs simultaneously. This makes psinode a tempting target for Linux's out-of-memory (OOM) killer, which strikes suddenly with `SIGKILL`. Triedent works to make its database robust against this, but not against kernel crashes, filesystem corruption, or power outages. If the OOM killer strikes, psinode's database should survive. If your machine loses power, or you use a remote filesystem, remote block store, or distributed block store, then psinode's database is vulnerable to undetectable corruption. Be especially cautious about using Kubernetes; it has a nasty habit of yanking volumes before the kernel has finished flushing a stopped container's memory-mapped files, causing corruption.

Since it's near-impossible to do SIGKILL coverage testing, we're going with a more aggressive option for now. During beta, psinode doesn't gracefully shutdown for SIGINT or SIGHUP. Instead, these kill psinode as aggressively as SIGKILL does. There may be a delay. This isn't psinode cleaning after itself; this is the kernel saving psinode's memory-mapped files.
