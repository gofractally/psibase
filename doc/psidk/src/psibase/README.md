# Psinode and Psibase

psidk comes with two executables for working with chains:

- `psinode` runs a chain. It can optionally be a producer or a non-producer node on a chain. It also optionally hosts an http interface which provides RPC services, GraphQL services, and hosts web UIs. On-chain contracts define most of the http interface.
- `psibase` is a command-line client for interacting with the chain. It connects to the http interface on a running node.

psinode has an explicit interface; it won't boot a new chain or connect to an existing chain unless you instruct it to. It also won't open any ports you didn't request or store its database at a location you didn't tell it about.

## psinode

psinode has the following command-line interface:

```
psinode [OPTIONS] <DATABASE>
```

`<DATABASE>`, which is required, is a path to the psibase database. psinode creates it if it does not already exist.

If you don't give it any other options, psinode will just sit there with nothing to do. There are three important options for creating and running a local test chain:

- `-p` or `--producer` tells psinode to produce blocks. It will not start production on an empty chain until you boot the chain (below).  It's argument is a name for the producer.  psinode will only produce blocks when it is this producer's turn according to consensus.  Multiple distinct nodes must not use the same producer name.
- `-o` or `--host` tells psinode to host the http interface. Its argument is a domain name which supports virtual hosting. e.g. if it's running on your local machine, use `psibase.127.0.0.1.sslip.io`. Right now it always hosts on address `0.0.0.0` (TODO).  The port defaults to 8080 but can be configured with `--port`.  The http interface also accepts p2p websocket connections from other nodes (see `--peer`).
- `-s` or `--sign` tells psinode a private key with which to sign blocks.  It must match the producer's public key.  If the producer has no key set, then it may be omitted.

Two more options are important for connecting multiple nodes together in a network:

- `--port` tells psinode the TCP port for the http interface.  The default port is 8080.  This option is only useful with `-o`.
- `--peer` tells psinode a peer to sync with.  The argument should have the form `host:port`.  This argument can appear any number of times.

There is one more option which is useful for local development. Production deployments shouldn't use this:

- `--slow` stops it from complaining when it is unable to lock memory for database. This will still attempt to lock memory, but if it fails it will continue to run, but more slowly. If you don't run with `--slow`, it will give suggestions on how to enable it to lock memory.

psinode does not include https hosting; use a reverse proxy to add that when hosting a public node.

## psibase

psibase provides commands for booting a chain, creating accounts, deploying contracts, and more. Notable options and commands for contract development:

- `-a` or `--api` tells it which api endpoint to connect to. This defaults to `http://psibase.127.0.0.1.sslip.io:8080/`.
- `boot` boots an empty chain; see below
- `deploy` deploys a contract; see [Basic Contract](../cpp-contract/basic/)

## Booting a chain

A chain doesn't exist until it's booted. This procedure boots a chain suitable for local development.

### Start psinode

```
psinode -p prod -o psibase.127.0.0.1.sslip.io my_psinode_db --slow
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

- A set of system contracts suitable for development
- A set of web-based user interfaces suitable for development
- `prod` as the sole block producer

`psibase boot` creates system accounts with no authentication, making it easy to manage them. If you intend to make the chain public, use boot's `-k` or `--key` option to set the public key for those accounts.

You may now interact with the chain using:

- The web UI at [http://psibase.127.0.0.1.sslip.io:8080/](http://psibase.127.0.0.1.sslip.io:8080/)
- Additional psibase commands
