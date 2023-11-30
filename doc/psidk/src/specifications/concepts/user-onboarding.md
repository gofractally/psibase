# User onboarding

## Motivation

User onboarding is one of the most important user experiences, as it is often one of the first interactions a new user has with a community. Each psibase account has associated configuration data and therefore has an associated storage cost. The challenge is that the value provided by each new user often accrues to a different entity than the one who bears the account creation cost (the infrastructure provider). This asymmetry has caused onboarding experiences to be cumbersome in other distributed app frameworks, and the friction slows the growth of the network. 

## Goals

The psibase onboarding experience is intended to be comparable to the experience of signing in using OAuth on traditional web applications. It should be simple and immersive. It should allow the entities and organizations who gain from the addition of a new user to subsidize their account creation cost.

### User flow

New users shall be onboarded through an invitation process. The default app responsible for the creation of new accounts is called [AccountSys](../../default-apps/account-sys.md). Any "invite" services which are permitted to facilitate the creation of a new account must be configured in this service.

> Note: The following designs are specifically for providing new accounts to *new* users. New accounts can be created by existing users simply by allowing them to pay a small amount for additional accounts.

Generic onboarding refers to a process that allows a user to invite another user to the network as a whole, rather than to participate in a particular psibase app.

An existing user may access an invite service, and create an invite. When the invite is created, an HTTP link is generated which can be sent to a recipient. A new psibase account can be redeemed by clicking the link and following the instructions provided in the interface provided by the invite app.

Similarly, Psibase apps can easily expose the ability for users to create invites through their app. When initiated, the app's service creates the invite, and the generated link can be sent to a recipient. By clicking the link, the invitee may join the app to which they were invited, and may optionally create a new psibase account in the process. 

After the invitee accepts the invite, they are redirected away from the invite page. If they were only given a generic invite, they will be directed to the root domain page. If they were given an app-specific invite link, they are directed back to either the root page of the app, or to a subpage (configurable by the app).

The user may then proceed to explore the community and its applications with their new user account.

## How it works

Embedded in the query string of the generated HTTP link is a private key, generated at the time of the invite. A corresponding invite public key is also saved in a service database. This public key is also known as the `invite ID`. For example, the query string may look like this: `?id=ABC123&signKey=DEF456`.

After the invitee clicks the link, and fills out their new account details in the invite plugin, they submit a transaction that prompts its creation. However, every transaction submitted to a psibase infrastructure provider must have a sender. Therefore, in order to submit this transaction, the invite service provides the account from which the transaction is sent (since the user may not have one yet). This sender account should use a custom auth service which authorizes actions if and only if the transaction is digitally signed with a private key that corresponds to an `invite ID`.

If the new account uses a PKI authorization service, such as [auth-sys](../../default-apps/auth-sys.md), it should not be configured to use the `invite ID` as its public key, since the invite creator also knows its corresponding private key.

### App onboarding

When an app needs to generate an invite link, it can use the `generateInvite` plugin function of the invite app. 

The invite plugin submits an action on behalf of the user to the psibase app's service to initiate the creation of an invite. The app's service should then call into the invite service to create the invite. This ensures that it is the psibase app's service who pays for the invite.

The invite service should allow psibase apps to register with it to configure rate-limiting details such as the number of open invites allowed per user, and the minimum age of an account that is permitted to generate invites.

In addition to the other parameters in the query string, an app invite link may also include a redirect subpage string, for example: `?id=ABC123&signKey=DEF456&redirect=welcome-page`. This allows the invite app to redirect the user back to the application that generated the invite link after the user onboarding is completed.

### Sequence diagram

The following sequence diagrams gives a rough outline of all the steps required to carry out the successful onboarding of a new user within an application willing to subsidize the invite cost.

```mermaid
sequenceDiagram
    title Creating an invite
    participant App
    participant Invite app
    participant Invite plugin
    participant Auth
    participant App service
    participant Invite service

    note over App: Alice generates<br>an invite
    App->>Invite plugin: generateInvite(alice,<br>"welcome-page")
    note over Invite plugin: Generate keypair<br>{PUB_ABC, PRIV_ABC}
    Invite plugin->>App service: createInvite(alice, <br>PUB_ABC)
    App service->>Invite service: createInvite(<br>PUB_ABC)
    note over Invite service: Invite created
    Invite plugin-->>App: invite link("/invite?id=PUB_ABC<br>&signKey=PRIV_ABC&redirect=welcome-page)
```

```mermaid
sequenceDiagram
    title Accepting an invite
    participant App
    participant Invite app
    participant Invite plugin
    participant Auth
    participant App service
    participant Invite service

    note over Invite app: Bob uses invite link<br>to submit new user details
    Invite app->>Invite plugin: acceptCreate(bob,<br>PUB_ABC, PRIV_ABC)
    Invite plugin->>Auth: Get keypair<br>for new account
    Auth-->>Invite plugin: {PUB_DEF}
    Invite plugin->>Invite service: acceptCreate(bob,<br>PUB_ABC, PUB_DEF)
    note over Invite service: Creates account
    Note over Invite plugin: Wait for account created
    Invite plugin-->>Invite app: Account created
    Note over Invite app: Redirect Bob to /subpage
```

