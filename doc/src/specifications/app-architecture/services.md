# Services

Services in a psibase network are programs that run inside a WebAssembly VM on the server. They import functionality from the host that gives them read/write database access, information about the current call context, and the ability to make calls into other services. They export an interface that is available for either users or other services to call.

The name "service" is used rather than "smart-contract" simply because it is standard terminology that can be more easily understood by anyone in the traditional web app development industry.

## State management

Data storage within services is flexible. Developers can define tables with custom record types and can define multiple indexes to increase the efficiency of queries on that data.

## Query handlers

Services can be registered with an `http-server` service to have http queries targeting the service handled directly by the registered service. When handling an http query, services may read from but not write to the service database. 

## Event emission

Services can emit events as a historical record that something happened. For example, a service that tracks user votes for candidates may have a "voted" event to represent the successful execution of the vote action. A historical record of all past events is not part of the state of the database that is permanently stored within the network. Instead, events are stored temporarily and can be pruned according to an infrastructure provider's own rules. Therefore, an app should not depend on the ability to look arbitrarily far into the history of past events and can only truly depend on the ability to look at the current state of the network.

It is worth noting that anyone who runs their own node in the network can independently configure their own rules regarding event storage.

### Limitations

Most of the same limitations apply to psibase services that apply to smart contracts in other protocols.

#### Public data

All data stored in the database by a service should be considered public and accessible, even if no explicit API is provided. It is always theoretically accessible by the infrastructure providers and therefore is not suitable for the storage of private unencrypted data.

#### Deterministic execution

The psibase protocol uses a blockchain to replicate data between all nodes in the network. The messages between nodes in the network contain information about calls to actions within services, but do not contain the resulting state. Instead, each node executes the action given the parameters, and is able to derive an identical state to that which is calculated by any other node in the network. Due to this design, all functionality in services that could produce data intended to be synchronized across the network must be deterministic. To satisfy this constraint, services lack some functionality that traditional web-app developers may expect to be available in their web services. For example, the host does not allow services to import any functionality that would enable them to make HTTP requests, because that could introduce a source of nondeterminism into otherwise deterministic action execution.
