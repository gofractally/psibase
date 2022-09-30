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

Keep in mind, some nodes may have smaller storage capacity, and may therefore be configured to "forget" past events beyond a particular time horizon. Therefore if you need to guarantee access to historical events to a specific time window, the safest way to accomplish this would be to run and configure your own full node. On the other hand, if your application simply needs to display the current state of a blockchain service, it may not be necessary to use the event system at all.

# Efficient event lookups

One challenge with an event system is in maintaining lookup efficiency. To show a list of historical token transactions, it would be inefficient to search through the entire event list to find the relevant events. Rather, Psibase provides a mechanism to aid in the construction of manual indices to drastically improve lookup efficiency.

Whenever an event is emitted, a unique event ID is returned to the caller. The solution to provide efficient lookups is to save the most recent emitted event ID in the blockchain state, and then include the previous event ID the next time an event is emitted. For example, look at the definition of the transferred event in the Token service.

<details>
  <summary>Reveal code</summary>

  ```cpp
      struct Events
      {
          struct History
          {
              void transferred(TID tokenId, uint64_t prevEvent, psibase::TimePointSec time, Account sender, Account receiver, Quantity amount, StringView memo) {}
          };
      };
  ```
</details>

<br>

Notice that when the transferred event gets emitted by the Token service, the previous event is included when emitting the new event, and the new event ID is saved to the database.

<details>
  <summary>Reveal code</summary>

  ```cpp
    // Emit the transferred event
    auto newEventID = emit().history().transferred(
        tokenId, 
        sender.lastHistoryEvent, // Include the previous event ID
        time, 
        sender, 
        receiver, 
        amount, 
        memo);
    
    // Update the previous event ID
    sender.lastHistoryEvent = newEventID;

    // Save the new sender record (with the updated event ID) to blockchain state
    db.open<TokenHolderTable>().put(sender);
  ```
</details>

<br>

As you can see, the second parameter that is provided in the event is the ID of the previous event. In this way, a linked list of `transferred` events is created. For the small price of storing only one extra field in the blockchain (per desired index), consumers of these events are now able to very efficiently query this event chain.

# Event types

All emitted events are one of three different event types. The three types are: History events, UI events, or merkle events. Three different event types are provided because there really are three distinct use-cases for the event system.

## History events (Long-term events)

The most common type of event is the history event. History events are emitted and stored to allow for the efficient historical event queries previously described. These events are more expensive to emit than UI events, because they are stored longer.

## UI events (Short-term events)

To understand UI events, think about how an application front-end will interact with the blockchain. The front-end will initialize and read blockchain state and/or historical events to display the current application state. Then, the front-end wants to get notified when there are updates that may be relevant to the information it displays to a user, but the information may not be the type of information that the application wants to store long-term. 

An example of this type of event is the `credited` event found in the Token service. We don't need to store a long-lived chain of credited events, since the most important information for a user is simply the total available balance that has been credited to them, or which they have credited to another. Therefore, an initializing user-interface doesn't rely on any credited event, it simply reads the credit tables to determine how to display that information to the user. But a credited event is still emitted to prompt a *live* user-interface to update its view on credited balances.

## Merkle events (Inter-blockchain communication events)

If you need a particular events to be provable on another Psibase chains, you would emit a Merkle event. Emitting a merkle event will ensure that the event is included in a merkle proof for that block, which could be used to prove that an event happened to another psibase blockchain.

If an events shouldn't need to be verified on another chain, then a merkle event need not be emitted. 

# Sample implementation

It may be instructive to see how the Token service uses events to provide relevant information to applets regarding users' token-related activities. The token service is a complicated blockchain service that requires the use of all three types of events. Many services won't need to use all three event types. For the purposes of this tutorial, we can look at how the token service uses history events to provide an efficiently queryable token transfer history for every user.

First, the `transferred` event is defined and reflected:

<details>
  <summary>Reveal code</summary>

  ```cpp
  class TokenSys : public psibase::Service<TokenSys>
  {
  public:
      
      // ... 

      struct Events
      {
          struct History
          {
              void transferred(TID tokenId, uint64_t prevEvent, psibase::TimePointSec time, Account sender, Account receiver, Quantity amount, StringView memo) {}
          };
      };
  };

  PSIBASE_REFLECT_EVENTS(TokenSys)
  PSIBASE_REFLECT_HISTORY_EVENTS(TokenSys,
      method(transferred, tokenId, prevEvent, time, sender, receiver, amount, memo)
  );
  ```
</details>

<br>

Next, the transferred event gets emitted in the `TokenSys::debit` action with the following lines:

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

Notice that the transferred event is emitted twice, and one of the events is saved as the head of the sender's index of `transferred` events, and the other event is saved as the head of the receiver's index of `transferred` events. Therefore, for a given user, the same index will contain all transferred events for both sending and receiving tokens.

Next, in the RPC handler for this service, you can see that the events are exposed to the front-ends via GraphQL:

<details>
  <summary>Reveal code</summary>

```cpp
struct TokenQuery
{
   auto events() const { return EventQuery<TokenSys::Events>{TokenSys::service}; }
};
PSIO_REFLECT(TokenQuery, method(events))

optional<HttpReply> RTokenSys::serveSys(HttpRequest request)
{
   if (auto result = serveGraphQL(request, TokenQuery{}))
      return result;
}
```
</details>

<br>

This setup allows front-end developers to design their user interfaces to accomplish two things:
1. Query the history of token transfer events


<details>
  <summary>Reveal code</summary>

```js
const queryTransferHistory = (holder: string) => `{
  holderEvents(holder: "${holder}") {
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
}`;


const transferHistoryResult = useGraphQLQuery("/graphql", queryTransferHistory(user));
```
</details>

<br>


An example of the GraphQl return object could be:

<details>
  <summary>Reveal code</summary>

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
                        "event_id": "18",
                        "event_type": "transferred",
                        "tokenId": 1,
                        "prevEvent": "15",
                        "time": "2022-09-23T18:59:56.000Z",
                        "sender": "bob",
                        "receiver": "alice",
                        "amount": {
                            "value": "10000000000"
                        },
                        "memo": {
                            "contents": "Working"
                        }
                    }
                },
                {
                    "node": {
                        "event_id": "15",
                        "event_type": "transferred",
                        "tokenId": 1,
                        "prevEvent": "10",
                        "time": "2022-09-23T18:59:19.000Z",
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
                        "event_id": "10",
                        "event_type": "transferred",
                        "tokenId": 1,
                        "prevEvent": "0",
                        "time": "1970-01-01T00:00:02.000Z",
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
    },
    "isLoading": false,
    "isError": false
}
```
</details>

<br>

