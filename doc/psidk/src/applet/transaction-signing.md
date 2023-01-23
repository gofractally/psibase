# Signing a transaction

If you're building a third-party app intended to integrate with a Psibase chain, you will find instructions for manually signing and pushing transactions in the section called "[Signing (js)](../http.md#signing-js)".

But if you're building an applet to be served directly from a Psibase chain, then you have access to libraries that simplify the process of constructing and signing transactions. In both cases, your transaction must contain claims that specify the public keys that your transaction signatures will authenticate, and proofs, or signatures, that prove the claims.

The following diagram describes how the architecture automatically gathers the claims and proofs used to authenticate your transaction if you're serving your app directly from a chain:

```mermaid
sequenceDiagram

participant applet
participant key_vault
participant common_sys
participant auth_service
participant action_service
participant chain


Note over applet,action_service: front-end
Note over chain: back-end

applet->>common_sys: action(service, actionName, params, alice)
common_sys->>common_sys: Lookup auth service (e.g. AuthEcSys) for sender
common_sys->>auth_service: GetClaim(sender, actionName, params), add result to transaction (Service: VerifyEcSys, RawData: PublicKey)
auth_service-->>common_sys: 
common_sys->>action_service: GetClaim(sender, actionName, params), add result to transaction (Service: VerifyEcSys, RawData: InvitePubKey)
action_service-->>common_sys: 
common_sys->>common_sys: Generate `hashedTransaction` from the transaction and its claims
Note over common_sys: If the claim specifies a service besides VerifyEcSys, then fail. Currently we only know how to submit transactions with key signing.
loop For each claim
   common_sys->>key_vault: getProof(hashedTransaction, claim)
   key_vault->>common_sys: Return proof
end
common_sys->>chain: Submit transaction
```
