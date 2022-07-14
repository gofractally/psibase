
## Team Management: Create a Team and Choose a Team Lead
```mermaid
sequenceDiagram
Actor alice
Actor bob
Actor carol
Actor dave

alice->>TokenSys: credit(from: founder, to: FractallySys, Amount, token)
alice->>FractallySys: createTeam(members: [alice, bob, carol, dave], name: "ATeam")
activate FractallySys
FractallySys->>TokenSys: debit(members: [alice, bob, carol, dave], name: "ATeam")
deactivate FractallySys

alice->>FractallySys: proposeLead(member: alice)
activate FractallySys
bob->>FractallySys: proposeLead(member: alice)
carol->>FractallySys: proposeLead(member: alice)
FractallySys-->>FractallySys: emit(setTeamLead: alice)
dave->>FractallySys: proposeLead(member: alice)
deactivate FractallySys
```

## Team Management: Add New Member
```mermaid
sequenceDiagram
Actor carol
Actor alice
Actor dave
Actor ed

carol->>FractallySys: proposeMember(teamName: "ATeam", member: "ed")
note right of FractallySys: Q: Support adding multiple people at once?
note right of FractallySys: (cont.) awkward if no but more complicated to manage if yes
activate FractallySys
note right of carol: proposer auto confirms proposed member
alice->>FractallySys: confirmMember(teamName: "ATeam", member: "ed")
dave->>FractallySys: confirmMember(teamName: "ATeam", member: "ed")
ed->>FractallySys: confirmMember(teamName: "ATeam", member: "ed")
FractallySys-->>FractallySys: emit(addMember: alice)
deactivate FractallySys
```

## Team Management: Member Elects to Leave Team
```mermaid
sequenceDiagram
Actor carol

carol->>FractallySys: initLeave(member: "carol", teamName: "ATeam")
activate FractallySys
note right of FractallySys: 20 weeks pass
FractallySys-->>FractallySys: emit(Team::memberLeft: carol)
deactivate FractallySys
```

## Team Management: Team Kicks a Member Off the Team
```mermaid
sequenceDiagram
Actor ed

ed->>FractallySys: initLeave(member: "bob", teamName: "ATeam")
activate FractallySys
note right of FractallySys: 20 weeks pass
note right of FractallySys: Q: Member is locked out of team actions because he was kicked?
FractallySys-->>FractallySys: emit(Team::memberEvicted: bob)
deactivate FractallySys
```

## Team Management: Team Lead Proposes Team Respect Transfer
```mermaid
sequenceDiagram
Actor alice

alice->>FractallySys: proposeTransfer(to: "bob", teamName: "ATeam", amount, memo)
note right of FractallySys: Q: token is assumed, given a team in a ƒractal will always have balance in that ƒractal's token?
FractallySys-->>FractallySys: emit(Team::transfer: to: bob, amount, memo)
note right of FractallySys: Q: xfer happens immediately because team lead proposed it?
```

## Team Management: Team Member Proposes Team Respect Transfer
```mermaid
sequenceDiagram
Actor bob
Actor carol
Actor dave
Actor ed

bob->>FractallySys: proposeTransfer(to: "bob", teamName: "ATeam", amount, memo)
activate FractallySys
carol->>FractallySys: confTransfer(teamXferID)
dave->>FractallySys: confTransfer(teamXferID)
ed->>FractallySys: confTransfer(teamXferID)
FractallySys-->>FractallySys: emit(teamTransfer: to: bob, amount, memo)
note right of FractallySys: xfer required 2/3 of team to confirm because it was proposed by a team member
deactivate FractallySys
```