
Notes:
- Resource management actions have been left out of these diagrams for simplicity
- These diagrams are in part intended to demonstrate user flows (in the userFlows subfolder)
- Where the details get technical and complex enough, certain flows have been broken out into separate diagrams (this folder).
 - In the technical diagrams, where technical details are uncertain, user-flow-level placeholders are present until these are reviewed

## Bootstrapping a Functioning Founder-Controlled ƒractal
```mermaid
sequenceDiagram
Actor founder
Actor alice

founder->>TokenSys: credit(token, receiver: FractallySys, qty, memo)

founder->>FractallySys: createFractal(acct: "Fractal1", name: "New Fractal", councilName: "Nicea")
activate FractallySys
note right of FractallySys: TODO: create account for Council
note right of FractallySys: Fall back to founder if fall under 3 teams
note right of FractallySys: founder is initial manager of ƒractal
note right of FractallySys: Council will become manager of ƒractal later on
note right of FractallySys: founder *is* the Council intially
FractallySys->>TokenSys: debit(token, sender: founder, qty, memo)
founder->>FractallySys: setMission()
deactivate FractallySys
note right of FractallySys: the Council can assign new founder
note right of FractallySys: rename founder: Chief, leader

founder->>FractallySys: inviteMember(account: alice)
founder->>FractallySys: schedule(dayOfWeek, frequency) - only Council can
note right of FractallySys: immediate because founder proposed
note right of FractallySys: TODO: add account creation on invite
note right of FractallySys: TODO: invite limits, invitee acceptance and terms
note right of FractallySys: TODO: setTerms (on Fractal)
note right of FractallySys: TODO: all set??? actions talk to Council contract
note right of FractallySys: TODO: invite currency that founder distributes and system burns as invites happen

alice->>FractallySys: inviteMember(account: bob)
note right of FractallySys: added members can also invite others
```

## Founder Passes Control to Council and Council Changes Meeting Schedule
```mermaid
sequenceDiagram
Actor founder
Actor alice
Actor bob
Actor carol

founder->>FractallySys: enableCouncil()
note right of FractallySys: TODO: Council takes control as soon as 3 teams, + 6 weeks (FTers)
note right of FractallySys: Any fee or particular resources required to make this transition? No
note right of FractallySys: Requires enough members/teams (min: 3 teams of 4 FTers each) to succeed

alice->>FractallySys: schedule(dayOfWeek, frequency)
note right of FractallySys: must be approved by Council. all proposals override prior proposals.

bob->>FractallySys: confSchedule()
carol->>FractallySys: confSchedule()
note right of FractallySys: to CouncilSys
note right of FractallySys: base msig contract will not have dynamic sig list
note right of FractallySys: CouncilSys will be derived from general msig contract
note right of FractallySys: All 3 teams or 2/3 of Council
FractallySys-->>FractallySys: emit(scheduleUpdated)
```

