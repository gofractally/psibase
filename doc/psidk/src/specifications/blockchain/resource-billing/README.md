# Resource consumption

There are two types of resource consumption: network resource consumption and node resource consumption. Network resource consumption refers to an account's consumption of resources that apply across all infrastructure nodes, such as the execution of a transaction that must be applied on every infrastructure node. Conversely, node resource consumption occurs when a user interacts with a node in a way that incurs a cost only to that specific node rather than to the entire network. In many blockchain designs, failed transactions consume node resources, but upon failure, they do not propagate to all other nodes, which means that they do not consume resources of the entire network. Other common examples include servicing state queries, snapshot generation, snapshot download, state indexing, and historical transaction storage.

Given the design of the psibase infrastructure, it is expected that there will be increased node resource consumption compared to other networks. This is primarily because services can directly service HTTP requests, and front-ends are stored on and served from nodes just like any other state.

# Billing

Billing for resource consumption rate-limits users and prevents abuse.

While all blockchain networks formalize billing for network resource consumption, typically in the form of transaction fees paid through a gas token, psibase additionally standardizes tracking node resource consumption to enable billing plans to exist directly between users and individual nodes.

- [Network resource consumption](network-resource-billing.md)
- [Node resource consumption](node-resource-billing.md)
