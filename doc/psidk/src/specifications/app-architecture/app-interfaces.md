# App interfaces

App interfaces run within a client's browser. These interfaces are intended to facilitate most interactions between user interfaces and services.

```mermaid
sequenceDiagram 

box rgb(85,85,85) client-side
actor Alice
participant UI
participant App interface
end

box rgb(85,85,85) server-side
participant psinode
end

Alice->>UI: Click
UI->>App interface: Call action
note over App interface: Internal logic
App interface->>psinode: Submit transaction

```

# Inter-app communication

Apps built on psibase make use of shared infrastructure, and as such have the option to interoperate in ways that are difficult or impossible for traditional web apps. On the server side, psibase services can simply call synchronous actions on each other. On the client-side, interfaces can make synchronous or asynchronous calls between each other.

On the client-side, an app may initiate a call to a function defined in the app-interface of another app. When this happens, a message is passed from the user interface of one app to the [supervisor](./supervisor.md), which then instantiates the target app interface in its own app domain, which ensures that local app data remains isolated except that which is intentionally exposed through an app interface.

```mermaid
sequenceDiagram 

box rgb(85,85,85) client-side, Domain 1
actor Alice
participant UI
participant App interface
end

box rgb(85,85,85) client-side, Domain 2
participant App interface2
end

box rgb(85,85,85) server-side
participant psinode
end

Alice->>UI: Click
UI->>App interface: Action
Note over App interface: Requires client-side<br>data from App 2
App interface->>App interface2: Query
App interface2-->>App interface: Response
App interface->>psinode: Submit transaction

```

## Cross-domain communication

Calls made across domains are done so via `Window.PostMessage`.

According to the [Window.postMessage documentation](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage):

> After postMessage() is called, the MessageEvent will be dispatched only after all pending execution contexts have finished.

Therefore `postMessage` does not immediately (synchronously) post to the other domain. Instead it schedules a payload to be dispatched after the completion of all remaining execution contexts. In order for cross-domain calls to appear synchronous, the caller should await the inter-applet call.

## Cross-domain security considerations

Cross-domain messaging can be dangerous if the proper checks are not in place to ensure that the messages are going to/from whoever is intended. 

The supervisor shall only listen for cross-domain messages from apps that it instantiated. The s


If interfaces make use of the core psibase libraries that enable inter-app communication, then many of the security concerns are handled automatically. For example, it is automatically enforced that messages into your interface are only allowed to come from the root domain. The root interface will also only accept messages from apps that it explicitly opened.

# Transaction packing

Transactions contain the data and authentication payload necessary to execute a service action on the server. Transactions may contain multiple actions. App interfaces are responsible for filling the transaction objects with actions.

An interface is by default ignorant of all actions added into a transaction except any that it was itself responsible for adding. This improves privacy on the client-side by ensuring that interfaces are only aware of the user's actions that are relevant to it.

Actions are added to transactions in a FIFO queue. For example, the following sequence diagram will finally submit a transaction containing actions in the order: A, B, C.

```mermaid
sequenceDiagram 

box rgb(85,85,85) client-side, Domain 1
actor Alice
participant UI
participant App interface
end

box rgb(85,85,85) client-side, Domain 2
participant App interface2
end

box rgb(85,85,85) server-side
participant psinode
end

Alice->>UI: Click
UI->>App interface: Do C
Note over App interface: Action A
App interface->>App interface2: Action
Note over App interface2: Action B
App interface2-->>App interface: Response
Note over App interface: Action C
App interface->>psinode: Submit transaction
```

# Transaction submission

For simplicity, the previous diagrams have shown the app interface as the component that submits the final transaction. But that would conflict with the principle of only allowing an app interface to know about the actions that it was itself responsible for adding to the transaction.

Instead, that responsibility is given to the root interface. The root interface refers to the interface running on the root domain which is actually the primary domain loaded in the client's browser (specific apps are all loaded within their own domains using iFrames).

The sequence looks more like the following, if we include the Root domain: 

```mermaid
sequenceDiagram 

box rgb(85,85,85) client-side, Domain 1
actor Alice
participant UI
participant App interface
end

box rgb(85,85,85) client-side, Root domain
participant root_interface
end

box rgb(85,85,85) server-side
participant psinode
end

Alice->>UI: Click
UI->>root_interface: Call action
root_interface->>App interface: Call action
activate App interface
App interface->>root_interface: Action A
activate root_interface
note over root_interface: transaction { A }
root_interface-->>App interface: Ok
deactivate root_interface
App interface-->>root_interface: Ok
deactivate App interface
root_interface->>psinode: Submit transaction

```

# The complete IAC interaction

The following sequence diagram shows an example of a complete interaction involving inter-app communication (IAC) as well as transaction packing and submission. It also attempts to show how the cross-domain messaging only occurs after the completion of all active execution contexts (EC). A key interaction that is intentionally left out of the following diagram for simplicity is the root domain process for the aggregation of digital signatures and other authorization payloads.

```mermaid
%%{init: { 'sequence': {'noteAlign': 'left'} }}%%
sequenceDiagram 

box rgb(85,85,85) client-side, Domain 1
participant UI
participant interface
end

box rgb(85,85,85) client-side, Root domain
participant root_interface
end

box rgb(85,85,85) client-side, Domain 2
participant interface_2
end

box rgb(85,85,85) server-side
participant psinode
end

Note over UI: [IAC - Wait on EC]
UI->>root_interface: Call action@interface
activate root_interface

root_interface->>psinode: Get interface
psinode-->>root_interface: reply
note over root_interface: [IAC - Wait on EC]
root_interface->>interface: action
activate interface

note over interface: [IAC - Wait on EC]
interface->>root_interface: Call action2@interface2
activate root_interface

root_interface->>psinode: Get interface2
psinode-->>root_interface: reply
note over root_interface: [IAC - Wait on EC]
root_interface->>interface_2: action2
activate interface_2

note over interface_2: [IAC - Wait on EC]
interface_2->>root_interface: Call action@serviceA
activate root_interface

note over root_interface: transaction { action@serviceA }

note over root_interface: [IAC - Wait on EC]
root_interface-->>interface_2: reply
deactivate root_interface
note over interface_2: [IAC - Wait on EC]
interface_2-->>root_interface: reply
deactivate interface_2

note over root_interface: [IAC - Wait on EC]
root_interface-->>interface: reply
deactivate root_interface

note over interface: [IAC - Wait on EC]
interface->>root_interface: Call action@serviceB
activate root_interface
note over root_interface: transaction { <br> action@serviceA,<br> action@serviceB<br>}
note over root_interface: [IAC - Wait on EC]
root_interface-->>interface: reply
deactivate root_interface
note over interface: [IAC - Wait on EC]
interface-->>root_interface: reply
deactivate interface

note over root_interface: [IAC - Wait on EC]
root_interface->>psinode: Submit transaction
psinode-->>root_interface: reply
root_interface-->>UI: reply
deactivate root_interface

```

# Simplified mental model

Inter-app communication is a complex coordination process facilitated by the root domain app. However, for most purposes, UI and interface developers do not need to understand this complexity. For most purposes, it is sufficient to imagine that when you call into another application, it is a simple synchronous call directly into the other application. 

With this simplified mental model, it is easier to see how these IAC capabilities lead to powerful client-side app composability. Consider the following example of an app that manages the creation of a token using some of the psibase example Token and Symbol services & interfaces.

```mermaid
sequenceDiagram

box rgb(85,85,85) client-side
participant TokenCreator app
participant Token interface
participant Symbol interface
end
participant psinode

Note over TokenCreator app: Alice submits form with new token<br>characteristics and symbol name

TokenCreator app->>Token interface: CreateToken
    Token interface->>Symbol interface: BuySymbol
        Symbol interface->>psinode: [Action] credit@token-sys
        Symbol interface->>psinode: [Action] buySymbol@symbol-sys
        Symbol interface-->>Token interface: reply
    Token interface->>psinode: [Action] mapToNewToken@symbol-sys
    Token interface-->>TokenCreator app: reply
```

As you can see, someone creating an app to facilitate the creation of tokens would simply need to call the correct Token interface action. The Token interface allows you to specify a symbol and will automatically purchase a symbol from a symbol market and map it to the new token. All of the various interactions result in calling three separate actions in psibase services. Those three actions will automatically be packaged into one single transaction, enabling for maximally efficient processing of the action on the server (authentication logic only runs once to verify the sender is authorized for the whole transaction, rather than authorization logic executing once for each action submitted in separate transactions).


# App interface developers

Although the code executes client-side, interfaces are very similar to services. For example, just as in the context of the execution of a service action the service has full control over its own database, interfaces are permitted to silently call actions on their own service (Without additional confirmation prompts to the end user). Therefore, failing to include the proper security checks in the interface could allow the service to be exploited, corrupting shared data. This is unlike the more familiar concerns of UI developers which are traditionally much more limited. 

Furthermore, writing an interface often requires detailed knowledge about how to correctly call service actions, and in what order. 

For these reasons, interfaces should be thought of as the responsibility of the back-end / service developer. Correspondingly, they can be written in the same programming language as services (Rust).

# Updating app interfaces

The intention is that the only code bundled in with a front-end app is the interface API, not the entire interface binary. The binary is requested at run-time by the client's browser. This is similar to how calls made to services will be bundled in with user interfaces and other client-code, but the implementation of the service actions are server side.

This implies that any changes to the interface API can break client code, just as changes to the service API can break client code. However, just as service implementations can be seamlessly updated to fix bugs or make improvements, interface implementations can also change, and all users of the app interface will automatically use the updated code.
