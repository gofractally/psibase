# Resource billing

Network resources are limited, and therefore every distributed computing network must have a strategy to bill users for network resource consumption in order to limit the effects of spam and appropriately rate limit users. Designing a system for resource billing is especially tricky because it is both a technical challenge to maximize the available resources of a distributed network, and an economic challenge to ensure the incentive structure aligns the interests of users, service operators, and infrastructure providers, and doesn't provide one party the ability to profit by exploiting another.

## Goals

1. The node resources available for processing transactions should be maximized.
2. The cost of acquiring the means to reserve network resources should be minimized.
3. Users should not be burdened with separately managing the various "real" network resources, like CPU, RAM, disk storage, and network bandwidth.
4. Users should be minimally burdened with reserving network resources. 
5. The opportunity to profit from speculating on the cost of future network resources should be minimized.

## The psibase solution

In psibase, infrastructure providers are trusted to act as oracles to report the real wall-clock time each transaction takes to run. This is known as a subjective billing system. This minimizes the overhead required for tracking CPU consumption, which lowers the cost of reserving resources and maximizes the amount of resources that can be allocated to servicing transactions on the network. Furthermore, it eliminates a particular class of resource-exhaustion attacks possible in systems that use [objective billing](#notes-on-objective-billing).

Those who submit transactions to psibase networks effectively pay a fee on every transaction. However, the fee is paid in a special gas token, and users acquire the gas token in bulk rather than in the small quantities needed at the point in time at which the network resources are reserved. The pool of gas tokens that have been bought by a user is known as the "gas tank". 

### The gas tank

Users fill their gas tank by exchanging the network token for gas tokens at an exchange rate of 1:1. But filling one's gas tank is not the same as reserving or consuming actual network resources. The network automatically calculates the resource consumption of a particular transaction and consumes the corresponding amount of gas from the user's tank. The consumed gas is used to buy & burn tokens from internal resource markets that each track the availability of individual network resources, such as CPU time, network bandwidth, and storage. These resource markets are internal in the sense that they are inaccessible to users, and are only accessed when consuming user gas tokens to pay for transactions. 

This design effectively eliminates speculation on network resources, since it is not possible to reserve resources in anticipation of future demand. Furthermore, gas tokens in a user's gas tank cannot be exchanged back into the network token that was originally used to acquire the gas tokens.

### Freeing data

In psibase, 50% of the current cost to store some amount of data being deleted is returned to the gas tank of the account responsible for freeing the data. Because the value is returned to the user in the form of gas tokens in their gas tank, it is effectively not an opportunity for speculation and profit. Instead, it can be thought of as an opportunity for an account to get a discount on future resource fees if they have old data that can be freed. Only 50% of the current cost is returned to the freeing user to further limit the incentive to squat on unused resources.

### Failed transaction billing

In some distributed network resource billing systems, those who provide API infrastructure to users for submitting transactions have their own "off-chain" strategies for rate limiting users, akin to traditional DDoS prevention techniques used by traditional web servers. This is to avoid a class of vulnerabilities that arise when a user cannot be held accountable (billed) for submitting failed transactions, even though real CPU time was consumed on the nodes who had to partially execute the transaction to determine that it failed. This is known as "shadow billing" because it is not "real" billing, but there is some hidden accounting on a particular API node that is tracking users and their failed transactions. 

Shadow billing is a difficult problem to avoid, and it's harmful for many reasons. Firstly, it degrades user-experience for honest users when they are "shadow banned" for accidentally submitting too many failed transactions to the same API provider, and there is no standard way to report the cause of the failure to the user. Secondly, it allows for spammers to multiply the impact of their attacks by submitting the maximum amount of failed transactions possible to each individual node until they reach the subjective spam thresholds set by each node.

Since psibase already uses subjective billing (elected infrastructure providers acting as trusted oracles of the real wall-clock time taken to execute a transaction), it is no change to the trust model to also allow these elected IPs to bill for failed transactions. Unlike some networks (e.g. Ethereum) transaction fees are not paid out to an individual infrastructure provider, so there is little economic interest for an IP to intentionally fail a transaction or over-bill for a failed transaction.

With this design, all billing appears on-chain. This fixes the user-experience for honest users by providing a transparent view of the cause of their transaction failures. It also allows all infrastructure providers to collaborate on spam mitigation, since any one of them can bill for a failed transaction which limits a spammer's ability to continue their attack regardless of which API endpoint is used.

## Why eliminate resource speculation?

Many resource billing designs do not fully appreciate the importance of minimizing the extent to which they enable users to speculate on and profit from reserving network resources. Just as users are never burdened to pay micro-fees to cover the cost of the resources consumed on every web server with which they interact, blockchain services ought to be able to cover the cost of the resource consumption required by usage of their own service on behalf of users. But this is only practical when resources can not be used for speculation and profit. If a network resource token is simply a tradable token on which users can speculate, then any attempt by a service to automatically allocate resources to a user is a potential avenue for users to profit by gaming the service and draining its resources. Therefore, the ability to speculate on network resources effectively guarantees the worst-case-scenario user-experience, wherein users must always manage their own resources. Conversely, if users cannot speculate on and profit from resources, then it allows the possibility for services to cover the cost of their own usage for users. There is no way for a user to profit off of the "free resources" and there is therefore significantly reduced incentive for a user to game this aspect of the service.

For example, due to the lack of speculation on resources, services on a psibase network can easily offer to create accounts on behalf of users, prefunded with some small amount of gas in the gas tank, providing significantly reduced onboarding friction from the perspective of the new user. 

## Notes on objective billing

Systems that bill fixed amounts based on the type of instructions executed are known as objective billing systems. They must either significantly over-charge for the right to consume resources or they are vulnerable to a particular type of resource exhaustion attack wherein an attacker can intentionally execute instructions that maximize the discrepancy between the computational cost and the fee charged for the instructions (e.g. the 2016 Shanghai DoS attacks on Ethereum). Furthermore, even objective billing systems ultimately depend on subjective governance for adjustments to the fee schedule or for the initial pricing of new instructions.

## Conclusion

The final result of this model is that all resources are priced based upon current demand, users never have to think about fees any more than they think about their electric meter and fluctuating electric rates, and no private interests are profiting by squatting on and reselling community commons.

