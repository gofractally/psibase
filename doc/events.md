# Background

Blockchain applications should aim to provide a user experience that exceeds those available in traditional centralized applications. To accomplish this goal, application user-interfaces must be able to easily retrieve information about blockchain services. 

A vital component of the solution in Psibase blockchains is the event system. It may seem complicated at first, but once you understand it you'll likely find it to be extremely useful and pleasant to work with.

# Events - What are they?

Events are objects that are stored in a database on the blockchain node. Crucially, these event objects are not stored in blockchain state, and are therefore only kept around for a limited time, configurable by the blockchain node itself. To use the event system requires some development on both the blockchain service side (back-end) and the applet side (UI/front-end). On the back-end, the blockchain service is responsible for:

1. Defining the events it can emit
2. Emitting the events
3. Exposing access to these events through RPC queries

On the front-end, the applet is simply responsible for consuming events exposed by the service, and displaying them in a meaninful way to the users.

## When are events useful to a front-end?

If your application simply needs to display the current state of a blockchain service, it may not even need to use the event system at all! But consider a wallet application, for example, in which the UI displays a list of historical transfers. All those historical transfers are not saved in active blockchain state, but each of those historical transfers would have emitted a `transferred` event, which the UI could query to show a list of all past transfers.

So when you do you need to use events? Whenever past events should be remembered! But keep in mind, some nodes may have smaller storage capacity, and may therefore be configured to "forget" past events beyond a particular time horizon.






# Events

From the perspective of a smart contract developer, emitting an event that can be picked up by UIs and other interested parties is simply done by storing data in a database. From the perspective of a UI developer or another party interested in responding to events, developers need only make RPC queries to a Psibase node to retrieve records from the database.

## IBC

If you need these events to be provable on other Psibase chains, you should store your event in the IBC database. This database is almost identical to the other auto-incrementing, write-only database, with two key differences: 
1. Merkle proofs are generated for each event to allow for efficient inter-blockchain verification of events.
2. This database is actually readable by smart contracts to allow them to more easily respond to recent events. However, after a certain window of time (for example, 30 days), the data will only be readable through RPC queries.
 
If these events are not of the type that could need to be verified on other chains, then you should opt out of the IBC database, and instead use a different write-only database, to avoid the cost and overhead of generating and storing merkle proofs.

## Linked-List Pattern

The system token contract showcases the use of a particular design pattern to grant more efficient access to historical events, with user-defined indices. This pattern should also be considered by developers of applications who expect that various user-interfaces may want to display historical data about their application. 

The pattern works as follows:  A smart contract stores an event in the UI store, rather than in the primary store, in order to save costs. The auto-incrementing key assigned to this event object is then saved in the primary store. The next time the smart contract goes to save a new event in the UI store, as part of the record it includes that key it had previously stored, which serves as a pointer to the previous event in the UI store. In this way, a linked list is formed of events in the UI store that point to previous events relevant to that application. Consumers of the UI store are now able to very efficiently jump through historical events that are relevant to the application, with only a minimal cost of one extra new field (per desired index) storing the last UI store key in the primary store. 






# Sample implementation

As an example, it is instructive to see how the Token service uses events to provide relevant information to applets regarding users' token-related activities. 

In the Token service on psibase blockchains, you can see the definition of the `transferred` event:

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

  PSIBASE_REFLECT_HISTORY_EVENTS(TokenSys,
      method(transferred, tokenId, prevEvent, time, sender, receiver, amount, memo)
  );
  ```
</details>

<br>

In the Token service implementation, you can see this transferred event gets emitted in the `TokenSys::debit` action with the following line:

<details>
  <summary>Reveal code</summary>

```cpp
void TokenSys::debit(TID tokenId, AccountNumber sender, Quantity amount, const_view<String> memo)
{
    // ...
    emit().history().transferred(tokenId, senderHolder.lastHistoryEvent, time, sender, receiver, amount, memo);
    // ...
}
```
</details>

<br>

And lastly, in the RPC handler for this service, you can see that the events are exposed to the front-ends via GraphQL:

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

