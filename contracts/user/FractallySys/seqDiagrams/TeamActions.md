
## Team Management: Create a Team and Choose a Team Lead
```mermaid
sequenceDiagram
Actor alice
Actor bob
Actor carol
Actor dave

alice->>TokenSys: credit(token, receiver: FractallySys, qty, memo)
alice->>FractallySys: createTeam(members: [alice, bob, carol, dave], acct: "ATeam", name: "A-Team")
activate FractallySys
note right of FractallySys: credit team account to FractallySys
note right of FractallySys: need ability to choose their contract
FractallySys->>TokenSys: debit(token, sender: FractallySys, qty, memo)
deactivate FractallySys

alice->>FractallySys: proposeLead(member: alice)
note right of FractallySys: just vote. at 2/3, swap team lead
note right of FractallySys: Lead can start member leaving (standard leave) team or invite someone with 3 day delay
note right of FractallySys: Person leaving team will always have to wait 12 weeks.
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
note right of FractallySys: Team lead says add member (with time delay)
note right of FractallySys: Team lead invites. new person accepts
note right of FractallySys: Q: Support adding multiple people at once? No, future.
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

carol->>TeamApp: resign(member: "carol", teamName: "ATeam")
activate TeamApp
note right of TeamApp: 20 weeks pass
TeamApp-->>TeamApp: emit(memberLeft: carol)
deactivate TeamApp
```

## Team Management: Team Kicks a Member Off the Team
```mermaid
sequenceDiagram
Actor ed

ed->>TeamApp: evict(member: "bob", teamName: "ATeam")
activate TeamApp
note right of TeamApp: 20 weeks pass
note right of TeamApp: Q: Member is locked out of team actions because he was kicked?
TeamApp-->>TeamApp: emit(TeamateRemoved: bob)
deactivate TeamApp
```

## Team Management: Team Lead Proposes Team Respect Transfer
```mermaid
sequenceDiagram
Actor alice

alice->>TeamApp: proposeTransfer(to: "bob", teamName: "ATeam", amount, memo)
note right of TeamApp: Q: token is assumed, given a team in a ƒractal will always have balance in that ƒractal's token? this is the pre-token
note right of TeamApp: team lead action + 3 days
TeamApp-->>TeamApp: emit(transfer: to: bob, amount, memo)
note right of TeamApp: Q: xfer happens immediately because team lead proposed it? No, 3 day delay
```

## Team Management: Team Member Proposes Team Respect Transfer
```mermaid
sequenceDiagram
Actor bob
Actor carol
Actor dave
Actor ed

bob->>TeamApp: proposeTransfer(to: "bob", teamName: "ATeam", amount, memo)
activate TeamApp
carol->>TeamApp: confTransfer(teamXferID)
dave->>TeamApp: confTransfer(teamXferID)
ed->>TeamApp: confTransfer(teamXferID)
TeamApp-->>TeamApp: emit(teamXfer: to: bob, amount, memo)
deactivate TeamApp
note right of TeamApp: xfer required 2/3 of team to confirm because it was proposed by a team member
```

## EXPERIMENTAL Team Management: Team Member Proposes Team Respect Transfer
```mermaid
sequenceDiagram
Actor bob
Actor carol
Actor dave
Actor ed

FractallySys->>TokenSys: credit(token, receiver: "ATeam", qty, memo)
note right of FractallySys: FractallySys credits weekly rewards to Team account as part of weekly accounting
bob->>ATeam: proposeTransfer(to: "bob", teamName: "ATeam", amount, memo)
activate ATeam
carol->>ATeam: confTransfer(teamXferID)
dave->>ATeam: confTransfer(teamXferID)
ed->>ATeam: confTransfer(teamXferID)
note right of FractallySys: xfer required 2/3 of team to confirm because it was proposed by a team member
ATeam->>TokenSys: debit(token, sender: FractallySys, qty, memo)
ATeam->>bob: credit(token, receiver: bob, qty, memo)
ATeam-->>ATeam: emit(teamXfer: to: bob, amount, memo)
deactivate ATeam
```