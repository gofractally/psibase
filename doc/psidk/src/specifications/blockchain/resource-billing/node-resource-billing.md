# Node resource billing

Node resources are consumed by failed transactions, queries, peering connections (for snapshot downloads or block synchronization), and other activities. The goal of the psibase node resource billing design is to allow for the emergence of a market for infrastructure node operation that maximizes the efficiency with which these node services are provided to users.

## Tracking node resource consumption

Some interactions with a full node are long and expensive, such as the request for snapshot data when a new node is syncing with the network. Other types of queries, like web app API requests, may be handled quickly and relatively inexpensively. In any case, psibase will track the node resource consumption for each user.

## Billing plans

The psibase infrastructure is unopinionated on if and how much a node operator should bill for node resource consumption. Tracking these costs allows for infrastructure providers to create their own billing strategies to compete for users. At the discretion of each infrastructure provider, some expensive interactions, such as peering, may first require the peering account to have signed up for a billing plan with the infrastructure provider.
