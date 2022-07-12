
## Team Management: Create a Team and Choose a Team Lead
```mermaid
sequenceDiagram
alice->>FractallySys: credit(from: founder, to: FractallySys, Amount, token)
alice->>FractallySys: createTeam(members: [alice, bob, carol, dave], name: "ATeam")

alice->>FractallySys: proposeLead(member: alice)
activate FractallySys
bob->>FractallySys: proposeLead(member: alice)
carol->>FractallySys: proposeLead(member: alice)
FractallySys->>FractallySys: emit(setTeamLead: alice)
dave->>FractallySys: proposeLead(member: alice)
deactivate FractallySys
```

## Team Management: Add New Member
```mermaid
sequenceDiagram
carol->>FractallySys: proposeMember(teamName: "ATeam", member: "ed")
activate FractallySys
note right of carol: proposer auto confirms proposed member
alice->>FractallySys: confirmMember(teamName: "ATeam", member: "ed")
dave->>FractallySys: confirmMember(teamName: "ATeam", member: "ed")
ed->>FractallySys: confirmMember(teamName: "ATeam", member: "ed")
FractallySys->>FractallySys: emit(addMember: alice)
deactivate FractallySys
```

## Team Management: Member Elects to Leave Team
```mermaid
sequenceDiagram
carol->>FractallySys: initLeave(member: "carol", teamName: "ATeam")
activate FractallySys
note right of FractallySys: 20 weeks pass
FractallySys->>FractallySys: emit(memberLeft: carol)
deactivate FractallySys
```

## Team Management: Team Kicks a Member Off the Team
```mermaid
sequenceDiagram
ed->>FractallySys: initLeave(member: "bob", teamName: "ATeam")
activate FractallySys
note right of FractallySys: 20 weeks pass
note right of FractallySys: Member is locked out of team actions because he was kicked
FractallySys->>FractallySys: emit(memberEvicted: bob)
deactivate FractallySys
```

## Team Management: Team Lead Proposes Team Respect Transfer
```mermaid
sequenceDiagram
alice->>FractallySys: proposeTransfer(to: "bob", teamName: "ATeam", amount, memo)
note right of FractallySys: token is assumed, given a team in a ƒractal will always have balance in that ƒractal's token
activate FractallySys
FractallySys->>FractallySys: emit(teamTransfer: to: bob, amount, memo)
note right of FractallySys: xfer happens immediately because team lead proposed it
deactivate FractallySys
```

## Team Management: Team Member Proposes Team Respect Transfer
```mermaid
sequenceDiagram
bob->>FractallySys: proposeTransfer(to: "bob", teamName: "ATeam", amount, memo)
activate FractallySys
carol->>FractallySys: confTransfer(teamXferID)
dave->>FractallySys: confTransfer(teamXferID)
ed->>FractallySys: confTransfer(teamXferID)
FractallySys->>FractallySys: emit(teamTransfer: to: bob, amount, memo)
note right of FractallySys: xfer required 2/3 of team to confirm because it was proposed by a team member
deactivate FractallySys
```