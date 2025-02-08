# Network resource billing

Network resources are consumed by transactions, and therefore a fee is paid for every transaction on a psibase network. The goal of the psibase network resource billing design is to create a system wherein all resources are priced based on current demand, resources are maximally available to those who intend to use them, and no private interests are profiting by squatting on and reselling community commons.

## Real-world resources

The following are four of the real-world resources that are consumed by transactions:

1. CPU time
2. Network bandwidth
3. Storage space
4. Temporary storage space

### CPU time consumed

This is the amount of time it takes to execute a transaction. There is a limited number of instructions a node can execute per unit time. Processing a transaction requires some of that limited capacity and definitionally decreases the capacity available for other transactions at that time.

Infrastructure providers are trusted to report the real wall-clock time each transaction takes to run. This type of design is known as a [subjective billing system](#subjective-vs-objective).

### Network bandwidth consumed

This is the amount of data that is sent in a transaction. Any network link has a limited capacity for data transmission that is partially consumed by the data sent in any transaction.

This can be objectively measured by measuring the number of bytes of data sent in a transaction.

### Storage space consumed

This is the amount of data that is written to the replicated database. There is a finite amount of storage space available, so any additional data storage requirements as a result of the execution of a transaction diminish the remaining amount of storage available for other transactions.

This can be objectively measured by measuring the number of bytes of data written to the database as a result of a transaction.

### Temporary storage space consumed

There is temporary storage space available in psibase networks that nodes will automatically delete after some amount of time. This is used for, among other things, event emission logs. The amount of space in temporary storage is finite, so any emitted events or other forms of consumption of temporary storage either diminish the remaining amount of unused temporary storage or cause the deletion of the oldest data.

## The resource token

Transaction fees are paid in a special resource token. Although an account's resource token balance may deplete slowly over time according to their network usage, the accounts acquire the resource token in bulk rather than in the small quantities needed at the point in time at which the network resources are reserved. This is analogous to highway toll cards that drivers load with a large balance all at once, and then it gradually depletes as they drive on toll roads.

Resource tokens are exchanged for the network token at an exchange rate of 1:1.

The resource token is untradable. Furthermore, resource tokens cannot be converted back into the network token. Once acquired, their only use is to pay for transaction fees.

## How to pay fees

After the network calculates the fee required for a particular transaction, it will be automatically deducted from the resource token balance of the account responsible for the resource consumption. The fee is used to buy and burn tokens from internal resource markets that each track the availability of the individual real-world network resources. These resource markets are inaccessible to users and are only accessed when consuming resource tokens to pay transaction fees.

### Freeing data

It costs resource tokens to consume some amount of the limited storage space on the network. Conversely, when data is deleted, resource tokens are returned to the account responsible for the deletion. The returned tokens are resource tokens, not network tokens, and therefore can only be used to offset the cost of future resource consumption. The amount returned is 50% of the current cost to store the amount of freed data at the time of deletion. If a positive delta exists between the cost at the time of storage and the amount returned at the time of deletion, the delta is effectively burned. This incentivizes the freeing of unused data while limiting the incentive to consume unused storage space for speculative purposes.
