
Notes:
- Resource managemen actions have been left out of these diagrams for simplicity
- These diagrams are in part intended to demonstrate user flows
- Where the details get technical and complex enough, certain flows have been broken out into separate diagrams.

## Bootstrapping a Functioning Founder-Controlled ƒractal
```mermaid
sequenceDiagram
Actor founder
Actor alice

founder->>TokenSys: credit(from: founder, to: FractallySys, Amount, token)

founder->>FractallySys: createFractal(acct: "Fractal1", name: "New Fractal", mission: "be excellent to each other", language: "English", timezone: "Americas")
note right of FractallySys: founder is initial manager of ƒractal
note right of FractallySys: Council will become manager of ƒractal later on
activate FractallySys
FractallySys->>TokenSys: debit(from: founder, to: FractallySys, amount, token)
deactivate FractallySys

founder->>FractallySys: inviteMember(account: alice)
founder->>FractallySys: proposeSchedule(dayOfWeek, frequency)
note right of FractallySys: immediate because founder proposed

alice->>FractallySys: inviteMember(account: bob)
note right of FractallySys: added members can also invite others
```
founder->>FractallySys: (optional) setFractName(name)
founder->>FractallySys: (optional) setFractMission(mission)
founder->>FractallySys: (optional) setFractLang(lang)
founder->>FractallySys: (optional) setFractTZ(timezone)

## Founder Passes Control to Council and Council Changes Meeting Schedule
```mermaid
sequenceDiagram
Actor founder
Actor alice
Actor bob
Actor carol

founder->>FractallySys: enableCouncil()
note right of FractallySys: Requires enough members/teams (min: 3 teams of 4 FTers each) to succeed

alice->>FractallySys: proposeSchedule(dayOfWeek, frequency)
note right of FractallySys: must be approved by Council. all proposals override prior proposals.

bob->>FractallySys: confSchedule()
carol->>FractallySys: confSchedule()
note right of FractallySys: All 3 teams or 2/3 of Council
```

