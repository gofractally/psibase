# Psinode and Psibase

psidk comes with two executables for working with chains:

- [psinode](psinode.md) runs a chain. It can optionally be a producer or a non-producer node on a chain. It also optionally hosts an http interface which provides RPC services, GraphQL services, and hosts web UIs. On-chain services define most of the http interface.
- [psibase](psibase.md) is a command-line client for interacting with the chain. It connects to the http interface on a running node.
