# Triedent

Blockchains coordinate shared state between different nodes. But within a single node, there is still an underlying database technology used to store, cache, and retrieve data from the device storage disk and/or RAM. Psibase also specifies the design and characteristics of this underlying database technology in order to maximize its throughput by working with the unique constraints of a blockchain use case. 

## Goals

1. Database read queries must run in parallel without significantly affecting write performance, allowing multi-core utilization for servicing read-only state access.

## Design

> The Triedent database design specification has not yet been documented. Currently, to learn more, see the reference implementation found [here](https://github.com/gofractally/psibase/tree/main/libraries/triedent).
