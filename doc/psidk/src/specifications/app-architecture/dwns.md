# Decentralized web nodes

DWNs are used as the mechanism to ensure that users remain sovereign over any data that is not stored as public blockchain data. Using DWNs allows users to change devices, browsers, or root domains, and still enjoy the same app user experience.

## Example diagrams

Diagram 1: Alice's game app wants access to alice's contacts

```mermaid
sequenceDiagram

participant game
participant game-plugin
participant supervisor
participant DWN
participant contacts-plugin

game-->>supervisor: get alice's contacts
    supervisor-->>contacts-plugin: getContacts
        contacts-plugin-->>supervisor: read({permission, game})
            supervisor-->>DWN: {from:alice, in:contacts,<br>action:get, paylod: <br>{table: permission}}
            DWN-->>supervisor: No
        supervisor-->>contacts-plugin: No
        
        note over contacts-plugin: Need auth<br>"Game may access contacts"
        contacts-plugin-->>supervisor: authrequest(/auth)
        note over supervisor: opens `contacts.psibase/auth`
        note over contacts-plugin: alice approved

        contacts-plugin-->>supervisor: write new permissions<br>to client storage
            supervisor-->>DWN: {from:alice, in:contacts,<br>action:permission, payload: <br>{actor: "game", data: "approved"}}
            DWN-->supervisor: 
        supervisor-->>contacts-plugin: 
        
        contacts-plugin->>supervisor: read(contacts)
            supervisor-->>DWN: {from:alice, in:contacts,<br>action:get, payload: <br>{table: "contacts"}}
            DWN-->supervisor: <contacts>
        supervisor-->contacts-plugin: <contacts>

    contacts-plugin-->supervisor: <contacts>

supervisor-->game: <contacts>
```

Note: In this model, I had been thinking that the supervisor/app would have a shared symmetric key with which the supervisor would encrypt dwn data. This would require the supervisor to be the one to read the data from the dwn though, exclusing external apps. Not sure if needed if the same UX can be provided to users.

> Todo: Need to make a diagram where the data stored in a dwn is not only accessibly by the supervisor, but available also to external apps.
