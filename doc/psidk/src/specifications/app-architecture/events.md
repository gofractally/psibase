# Events

## Background

Many modern web services not only need the ability to display data regarding the current state of an application, but it is often helpful to also display a record of the historical events that modified or were otherwise relevant to the application state. This implies that the state of an application should also include a historical record of events that modify other state. The challenge is that individual web service developers often lack the domain expertise to design an efficient solution, which should include Event creation, storage, queryability, and pruning.

The psibase platform acknowledges this challenge, and provides an efficient, flexible, and simple solution for all web service developers. This greatly simplifies the expertise required to develop professional web services with excellent user-experience, minimizes time spent working with third-party services, and maximises the time developers are able to spend building their actual service.

The psibase event system is one of its many important innovations. If you're an application developer, it's worth taking time to understand it.

## What are psibase events?

Events are queryable objects that are stored in a database and that describe past events related to a particular web service. Since events do not store the active service state, they could be pruned without affecting the core operations of a particular service, and therefore psinode allows operators to configure the conditions in which events are automatically pruned.

There are several different databases managed by psinode, two of them are:

| Database Type | Prunable | Description             |
| ------------- | -------- | ----------------------- |
| Service State | No       | Distributed chain state |
| Event Log     | Yes      | Local event log         |

A service is responsible for defining the types of events it can emit, specifying how they should be indexed, emitting the events, and exposing access to event queries through the `Events` service. 

## Event queries

Any UI may query service events through the [Events](../../default-apps/events.md) query interface and display them according to its users' needs. Psibase apps are also able to use the Event Sourcing design pattern, in which they may subscribe to events and define handlers for automatic execution whenever such events are emitted.

### When are events consumed by a front-end?

The primary reason that events are consumed in an app is to view historical events related to a particular web service. If your application only needs to display the current state of a web service, it may not be necessary to use the psibase event system at all. Another use-case allows cryptographic proofs to be generated for events, which could allow separate psibase networks that do not trust each other to mathematically prove to each other when various events happen, but this use-case is outside the scope of this document.

Imagine a web service that facilitates the transfer of some kind of "tokens." Such an application may not only want to display a user's current balance of these tokens, but also display a historical view of any events that would have affected the user balance. Such historical transfers are an example use case for the psibase event system. To accomplish this, a web service developer would emit a `transferred` event after each transfer, which would facilitate the creation and storage of an event into the prunable event database that could be queried by the front-end to display the list of historical events.

Psinode may be deployed on hardware with limited storage capacity, and therefore the node operators may configure event stores to prune more quickly than would be desired by a particular web service. Therefore, the safest way to guarantee your app will keep access to a sufficiently large history of events is to run your own node, rather than rely on a third-party node.

## Custom indices

One challenge with an event system is in maintaining lookup efficiency. If all events were simply stored in a list, lookups would require linear-time searches through the list to construct the subset of events relevant to the query. Rather, psibase provides a mechanism to aid in the construction of manual indices on events to drastically improve lookup efficiency.

> Todo: Document process of setting up the schema and indices 

## Event types

All emitted events are either History events or Merkle events.

### History events

The most common type of event is the history event. History events are emitted and stored to allow for the efficient historical event queries previously described.

### Merkle events

Emitting a merkle event will ensure that a merkle proof is generated for that event, which is a type of cryptographic proof that could be used to prove to a third-party psibase network that an event has occured.

If the developer isn't concerned with the interaction of their service with multiple psibase deployments, then she should not emit a merkle event.

## Conclusion

Event IDs are unique between all web services on a particular psibase deployment. Because of that, proof of an event on a psibase deployment can be established by sharing a link to a query for an event ID that returns the relevant event.

Psibase events are not simply stored in an ever-growing list with linear search times. Rather, developers can create custom indices on events emitted by their service, guaranteeing fast historical access times.

Unlike other web service deployment architectures, no third-party tools are needed to index and expose access to events. All events may be easily exposed to the public over GraphQL interfaces by adding a few simple lines of code in an RPC service.

The psibase event system is a powerful example of one of the many innovations that allows psibase to uniquely meet the growing needs of modern web applications.
