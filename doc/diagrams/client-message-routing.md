Whenever we call operation(), action(), or query() inside an applet, `Window.postMessage` is used to send a specific message to the common-sys window.

According to the [Window.postMessage documentation](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage):

> After postMessage() is called, the MessageEvent will be dispatched only after all pending execution contexts have finished.
Therefore postMessage in the below diagrams does not immediately post to the other window. Instead it schedules a payload to be dispatched after the completion of all remaining execution contexts.

```mermaid
sequenceDiagram

title Client message routing: Operation

participant applet_1
participant applet_1_rpc
participant core
participant core_rpc
participant applet_2_rpc
participant applet_2
participant chain

activate applet_1
applet_1->>applet_1_rpc: operation1
note over applet_1_rpc: postMessage(operation1)
applet_1_rpc-->>applet_1: 

note over applet_1_rpc,applet_1: Waiting on IO<br>(Execution Contexts finished)
applet_1_rpc->>core: operation1

deactivate applet_1


note over applet_1,chain: 

activate core
note over core: ops: [<br> applet_1<br>]
core->>chain: request applet 2
chain-->>core: 
note over core: waits for applet_2 to load
core->>core_rpc: operation1
note over core_rpc: After-EC: postMessage(operation1)
core_rpc-->>core: 

note over core,core_rpc: Waiting on messages
core_rpc->>applet_2_rpc: operation1
deactivate core


note over applet_1,chain: 


activate applet_2
applet_2_rpc->>applet_2: operation1
applet_2-->applet_2_rpc: 
note over applet_2_rpc: In 100ms: After-EC: postMessage(operationEnded)

applet_2->>applet_2_rpc: action1
note over applet_2_rpc: After-EC: postMessage(action1)
applet_2_rpc-->>applet_2: 

note over applet_2_rpc,applet_2: Waiting on IO<br>(Execution Contexts finished)
applet_2_rpc->>core: action1


note over applet_1,chain: 


activate core
note over core: add to transaction: [action1]
deactivate core


note over applet_1,chain: 


note over applet_2_rpc: 100ms passed
note over applet_2_rpc: After-EC: postMessage(operationEnded)

note over applet_2_rpc,applet_2: Waiting on IO<br>(Execution Contexts finished)
applet_2_rpc->>core: postMessage(operationEnded)
deactivate applet_2


note over applet_1,chain: 


activate core
note over core: ops: []
core->>chain: pushTransaction(transaction)
chain-->>core: 
deactivate core

note over chain: transaction finished

```










```mermaid
sequenceDiagram

title Client message routing: Query

participant applet_1
participant applet_1_rpc
participant core
participant core_rpc
participant applet_2_rpc
participant applet_2
participant chain

activate applet_1
applet_1->>applet_1_rpc: query1(callback)
note over applet_1_rpc: After-EC: postMessage(query1)
applet_1_rpc-->>applet_1: 

Note over applet_1, applet_1_rpc: Waiting on IO<br>(Execution Contexts finished)
applet_1_rpc->>core: query1
deactivate applet_1


note over applet_1,chain: 

activate core
core->>chain: request applet 2
chain-->>core: 
note over core: waits for applet_2 to load
core->>core_rpc: query1
note over core_rpc: After-EC: postMessage(query1)
core_rpc-->>core: 

note over core, core_rpc: Waiting on messages
core_rpc->>applet_2_rpc: query1
deactivate core


note over applet_1,chain: 


activate applet_2
applet_2_rpc->>applet_2: query1(params, callback)
note over applet_2: calls callback(queryResult)
note over applet_2_rpc: After-EC: postMessage(query1Result)

note over applet_2_rpc,applet_2: Waiting for IO<br>(Execution Contexts finished)
applet_2_rpc->>core: query1Result
deactivate applet_2


note over applet_1,chain: 


activate core
core->>core_rpc: query1Result
note over core_rpc: After-EC: postMessage(query1Result)
core_rpc-->>core: 

note over core, core_rpc: Waiting for messages<br>(Execution Contexts finished)
core_rpc->>applet_1_rpc: query1Result
deactivate core


note over applet_1,chain: 


activate applet_1
applet_1_rpc->>applet_1: query1Callback()
applet_1-->>applet_1_rpc: 
deactivate applet_1

```