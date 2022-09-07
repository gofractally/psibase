
```mermaid

sequenceDiagram
   actor Alice
   participant Account applet
   participant Keystore applet
   participant Psibase
   note over Alice, Keystore applet: client-side

   Note over Alice: Navigates to psibase homepage, <br>navigates to Account applet
   Note over Account applet: Shows "No accounts" with button for "Import with private key"
   Alice->>Account applet: Clicks import
   Account applet-->>Keystore applet: Import by key
   activate Keystore applet
   Keystore applet-->>Alice: Modal prompt for key
   Alice->>Keystore applet: Enters private key, clicks "Import"
   Keystore applet->>Psibase: Check that key has corresponding account
   Psibase-->>Keystore applet: 
   Note over Keystore applet: Save private key to local storage
   Keystore applet-->>Account applet: public key
   deactivate Keystore applet
   
   Account applet->>Alice: Offer list of accounts to import
   Alice-->>Account applet: Makes selection
   Note over Account applet: Imports selected accounts

```
