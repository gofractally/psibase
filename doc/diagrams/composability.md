# Diagram to showcase modular client-side action interfaces
```mermaid
sequenceDiagram

actor Alice
participant TokenCreator applet
participant Core
participant Token applet
participant Symbol applet
participant Account applet
participant Psibase blockchain

title Alice using third-party app to create a token with a symbol & custom configuration
Alice->>TokenCreator applet: Submits form with new token<br> characteristics and symbol name


TokenCreator applet->>Core: [Operation-1] CreateToken
Core->>Token applet: 
activate Token applet
Token applet->>Symbol applet: [Operation-1A] BuySymbol
    activate Symbol applet
    Symbol applet->>Core: [Action] token-sys:credit
    Symbol applet->>Core: [Action] symbol-sys:buySymbol
    Symbol applet-->>Token applet: end [operation-1A]
    deactivate Symbol applet
Token applet->>Core: [Action] symbol-sys:mapToNewToken
Token applet-->>Core: end [operation-1]
deactivate Token applet

note over Core: 3 actions to submit
Core->>Token applet: For token-sys:credit<br>Get permission for Symbol to call<br>credit on Alice's behalf
Token applet-->>Core: 
Core->>Symbol applet: For symbol-sys:mapToNewToken<br>Get permission for Token to call<br>mapToNewToken transcript on Alice's behalf
Symbol applet-->>Core: 
Core->>Account applet: Sign transaction
Account applet-->>Core: 
Core->>Psibase blockchain: Submit transaction
Psibase blockchain-->>Core: 
Core-->>TokenCreator applet: end [Operation-1]
TokenCreator applet->>TokenCreator applet: Listens for SymbolMapped event
TokenCreator applet-->>Alice: Done
```