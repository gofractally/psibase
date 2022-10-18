# Background

Blockchain applications should aim to provide a user experience that exceeds those available in traditional centralized applications. To accomplish this goal, application user-interfaces must be able to easily retrieve information about blockchain services. 

A vital component of the solution in Psibase blockchains is the event system. If you're an application developer, it's worth taking time to understand it deeply.

# Events - What are they?

Events are objects that are stored in a database on the blockchain node. Crucially, these event objects are not stored in blockchain state, and are therefore only kept around for a limited time, configurable by the blockchain node itself. To use the event system requires some development on both the blockchain service side (back-end) and the applet side (UI/front-end). On the back-end, the blockchain service is responsible for:

1. Defining the events it can emit
2. Emitting the events
3. Exposing access to these events through RPC queries

On the front-end, the applet is simply responsible for consuming events exposed by the service, and displaying them in a meaninful way to the users. 

## When are events consumed by a front-end?

Events are typically consumed on the front-end for two reasons:

1. To view the historical activity of a user as it relates to a particular blockchain service
2. To be notified of a state change that happened in real-time while an interface was being viewed

For example, a wallet application may want to display a historical view of all past transfers into and out of a particular user account. All those historical transfers are not saved in active blockchain state, but each of those historical transfers would have emitted a `transferred` event, which the UI could query to efficiently retrieve a list of all past transfers.

Keep in mind, some nodes may have smaller storage capacity, and may therefore be configured to "forget" past events beyond a particular time horizon. Therefore if you need to guarantee access to historical events to a specific time window, the safest way to accomplish this would be to configure and run your own full node. On the other hand, if your application simply needs to display the current state of a blockchain service, it may not be necessary to use the event system at all.

# Emitting event chains

One challenge with an event system is in maintaining lookup efficiency. To show a list of historical token transactions, it would be inefficient to search through the entire event list to find the relevant events. Rather, Psibase provides a mechanism to aid in the construction of manual indices to drastically improve lookup efficiency.

Whenever an event is emitted, a unique event ID is returned to the caller. The solution to provide efficient lookups is to save the most recently emitted event ID (i.e. event head) in blockchain state, and each event will itself include a field that indicates the previous event in that index. For example, in the Token Service, a Transferred event is defined, and is included in an index of events called `HolderEvents`:

<details>
  <summary>Reveal code</summary>

  ```cpp
    struct Events
    {
        struct History
        {
            // Define the transferred event
            void transferred(TID tokenId, uint64_t prevEvent, psibase::TimePointSec time, Account sender, Account receiver, Quantity amount, StringView memo) {}
        };
    };

    // Specify the details needed to create an index of events.
    using HolderEvents = psibase::EventIndex<&TokenHolderRecord::lastHistoryEvent, "prevEvent">;

    // Reflect the events
    PSIBASE_REFLECT_EVENTS(TokenSys)
    PSIBASE_REFLECT_HISTORY_EVENTS(TokenSys,
        method(transferred, tokenId, prevEvent, time, sender, receiver, amount, memo)
    );
  ```
</details>

<br>

The definition of `HolderEvents` indicates that the head event ID (most recently emitted event related to a Token Holder) is stored in the `lastHistoryEvent` field of the `TokenHolderRecord` record, and the field stored in the event that specifies the ID of the previous event is named, `prevEvent`. 

Notice that when the transferred event gets emitted by the Token service, the ID of the previous transferred event is included (via the `prevEvent` field) in the new event, and the event ID of the new event is saved to state (in the `lastHistoryEvent` field of the sender's `TokenHolderRecord`):

<details>
  <summary>Reveal code</summary>

```cpp
void TokenSys::debit(TID tokenId, AccountNumber sender, Quantity amount, const_view<String> memo)
{
    // ...
    
    auto senderHolder             = getTokenHolder(sender);
    senderHolder.lastHistoryEvent = emit().history().transferred( 
        tokenId, senderHolder.lastHistoryEvent, time, sender, receiver, amount, memo);
    db.open<TokenHolderTable>().put(senderHolder);

    auto receiverHolder             = getTokenHolder(receiver);
    receiverHolder.lastHistoryEvent = emit().history().transferred(
        tokenId, receiverHolder.lastHistoryEvent, time, sender, receiver, amount, memo);
    db.open<TokenHolderTable>().put(receiverHolder);

    // ...
}
```
</details>

<br>

<details>
  <summary>Reveal alternate code</summary>

```cpp
void TokenSys::debit(TID tokenId, AccountNumber sender, Quantity amount, const_view<String> memo)
{
    // ...

    emit<HolderEvents>(sender).history().transferred(
        tokenId, senderHolder.lastHistoryEvent, time, sender, receiver, amount, memo);

    emit<HolderEvents>(receiver).history().transferred(
        tokenId, receiverHolder.lastHistoryEvent, time, sender, receiver, amount, memo);

    // ...
}
```
</details>

<br>

Notice that the transferred event is emitted twice, in order to generate the event for the sender's "HolderEvents" index, and another event for the receiver's "HolderEvents" index. As you will see, Psibase has mechanisms for efficiently querying event chains created in this way, for the small price of storing only one extra field (per desired index) in blockchain state.

# Providing GraphQL access to event chains

In Psibase, it is very simple to provide GraphQL access to any event chain. In the below example, you can see how the Token RPC Service exposes an index of all events (via the `events` query), and an index on just the "Holder Events" (via the `holderEvents` query):

<details>
  <summary>Reveal code</summary>

  ```cpp
    // Create a QueryableService object using TokenSys service details
    auto tokenSys = QueryableService<TokenSys::Tables, TokenSys::Events>{TokenSys::service};

    // Construct and reflect the query object
    struct TokenQuery
    {
        auto events() const
        {
            return tokenSys.allEvents();
        }
        auto holderEvents(AccountNumber holder, optional<uint32_t> first, const optional<string>& after) const
        {
            return tokenSys.eventIndex<TokenSys::HolderEvents>(holder, first, after);
        }
    };
    PSIO_REFLECT(TokenQuery, 
        method(events), 
        method(holderEvents, holder, first, after)
    )

    // Expose the defined queries over a GraphQL interface
    optional<HttpReply> RTokenSys::serveSys(HttpRequest request)
    {
        if (auto result = serveGraphQL(request, TokenQuery{}))
            return result;

        return nullopt;
    }
  ```
</details>

<br>

Once the above Service and RPC Service are deployed, a front-end developer may access `https://token-sys.<domain>/graphql` to see these queries are now available as part of the TokenSys GraphQL schema:

<details>
  <summary>Reveal</summary>

  ```
    ...
    type Query {
        events: TokenSys_Events!
        holderEvents(holder: String! first: Float after: String): TokenSys_EventsHistoryConnection!
    }

  ```
</details>

<br>

A query for the Holder Events index can be easily constructed by following that GraphQL Schema:

<details>
  <summary>Reveal</summary>

  ```
    query {
    holderEvents(holder: "alice") {
        pageInfo {
            hasNextPage
            endCursor
        }
        edges {
            node {
                event_id
                event_type
                event_all_content
            }
        }
    }
}
  ```
</details>

<br>

Which, when submitted to a full-node, returns the Holder Events index as expected:

<details>
  <summary>Reveal</summary>

  ```
    {
        "data": {
            "holderEvents": {
                "pageInfo": {
                    "hasNextPage": false,
                    "endCursor": "10"
                },
                "edges": [
                    {
                        "node": {
                            "event_id": "15",
                            "event_type": "transferred",
                            "tokenId": 1,
                            "prevEvent": "14",
                            "time": "2022-09-21T22:05:56.000Z",
                            "sender": "alice",
                            "receiver": "bob",
                            "amount": {
                                "value": "1200000000"
                            },
                            "memo": {
                                "contents": "Working"
                            }
                        }
                    },
                    {
                        "node": {
                            "event_id": "14",
                            "event_type": "transferred",
                            "tokenId": 1,
                            "prevEvent": "10",
                            "time": "2022-09-19T21:08:49.000Z",
                            "sender": "bob",
                            "receiver": "alice",
                            "amount": {
                                "value": "1000000000"
                            },
                            "memo": {
                                "contents": "Working"
                            }
                        }
                    },
                    {
                        "node": {
                            "event_id": "10",
                            "event_type": "transferred",
                            "tokenId": 1,
                            "prevEvent": "0",
                            "time": "2022-09-19T16:15:21.000Z",
                            "sender": "symbol-sys",
                            "receiver": "alice",
                            "amount": {
                                "value": "100000000000"
                            },
                            "memo": {
                                "contents": "memo"
                            }
                        }
                    }
                ]
            }
        }
    }
  ```
</details>

<br>

# Event types

All emitted events are one of three different event types. The three types are: History events, UI events, or merkle events. Three different event types are provided because there are three distinct use-cases for the event system.

## History events (Long-term events)

The most common type of event is the history event. History events are emitted and stored to allow for the efficient historical event queries previously described. These events are more expensive to emit than UI events, because they are stored longer.

## UI events (Short-term events)

To understand UI events, think about how an application front-end will interact with the blockchain. The front-end will initialize and read blockchain state and/or historical events to display the current application state. Then, the front-end wants to get notified when there are updates that may be relevant to the information it displays to a user, but the information may not be the type of information that the application wants to store long-term. 

An example of this type of event is the `credited` event found in the Token service. We don't need to store a long-lived chain of credited events, since the most important information for a user is simply the total available balance that has been credited to them, or which they have credited to another. Therefore, an initializing user-interface doesn't rely on any credited event, it simply reads the credit tables to determine how to display that information to the user. But a credited event is still emitted to prompt a *live* user-interface to update its view on credited balances.

## Merkle events (Inter-blockchain communication events)

If you need a particular events to be provable on another Psibase chains, you would emit a Merkle event. Emitting a merkle event will ensure that the event is included in a merkle proof for that block, which could be used to prove that an event happened to another psibase blockchain.

If an events shouldn't need to be verified on another chain, then a merkle event need not be emitted. 

# Conclusion

In Psibase, the philosophy is that "transactions" or "groups of actions" should not be user-facing. Unlike other blockchains that provide users transaction IDs (txids) for each blockchain interaction, Psibase provides Event IDs. Proof of any event can then be established by providing someone a link to a query that returns the event.

Events in Psibase are not simply stored in an ever-growing log with correspondingly growing search times. Rather, developers can create custom indices on all events emitted by their service, guaranteeing fast historical access times.

No third-party tools are therefore needed to index and expose access to on-chain events. All events may be easily exposed to the public over GraphQL interfaces by adding a few simple lines of code in an RPC service.

The Psibase event system is a powerful example of one of the many innovations that allow Psibase blockchains to uniquely meet the growing needs of the decentralized internet.