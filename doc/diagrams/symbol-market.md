```mermaid

sequenceDiagram
    actor Alice
    participant Core applet
    participant Account applet
    participant Symbol applet
    participant Token applet
    participant Psibase blockchain

    note over Alice, Token applet: client-side

    Alice->>Symbol applet: Buy symbol
    activate Symbol applet
    Symbol applet-->>Core applet: Actions [Token-sys: credit,<br> symbol-sys: buySymbol]
    Core applet-->>Token applet: Is Symbol applet allowed to act on Alice's behalf?
    activate Token applet
    Note over Token applet: Check local storage <br> [No answer found]
    Token applet-->>Alice: Do you allow Symbol applet to use <br> Token applet on your behalf?
    Note over Alice: View Modal options: <br> #9744; No <br> #9744; Just once <br> #9744; Conditionally() <br> #9745; Always
    Alice->>Token applet: Always
    Note over Token applet: Save answer to local storage
    Token applet-->>Core applet: Yes
    deactivate Token applet
    Core->>Account applet: Sign transaction
    Account applet-->>Core: 
    Core applet-->>Psibase blockchain: Submit transaction
    Note over Psibase blockchain: Resolve transaction
    Psibase blockchain-->>Core applet: 
    Core applet-->>Symbol applet: 
    Symbol applet-->>Alice: Show Success
    deactivate Symbol applet

```