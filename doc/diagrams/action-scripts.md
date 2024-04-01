```mermaid
sequenceDiagram

actor Alice
participant Auth
participant Transact
participant Symbol
participant TokenSys

Alice->>Transact: alice@Transact:runAs( <br>"Symbol:create", {"TokenSys:Credit"}) 
Note over Transact: Alice wants to run the "create" action<br>script, which she gives permission to run the<br> credit action in TokenSys on her behalf.
Transact->>Auth: Is action permitted to run?
Auth-->>Transact: Yes
Transact->>Symbol: alice@Symbol:create
Symbol->>Transact: Symbol@Transact:runAs(<br>"TokenSys:Credit", {})
Transact->>Auth: Is action permitted to run?
Auth-->>Transact: Yes
Transact->>TokenSys: alice@TokenSys:credit
TokenSys-->>Transact: 
Transact-->>Symbol: 
Symbol->>TokenSys: Symbol@TokenSys:debit
TokenSys-->>Symbol: 
Symbol->>Symbol: Create new symbol
Symbol-->>Transact: 
Transact-->>Alice: Success

```