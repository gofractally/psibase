## Members Participating in Weekly Meeting
```mermaid
sequenceDiagram
Actor anyone
Actor alice

anyone-->>FractallySys: triggerEvents()
note right of FractallySys: triggerEvents --> cron --> processWork
note right of FractallySys: make all these `triggerEvents()` implicit
note right of FractallySys: Anyone can click Start if someone hasn't responded about reveal eg.
note right of FractallySys: So UI can call `poke` but only when needed
FractallySys-->>FractallySys: emit(checkinStart)
alice->>FractallySys: checkin(hash(entropy))
note right of alice: bob, carol, dave, henry, ivan, jen, kaley, mandy, nancy, opie, pete also check in
FractallySys-->>FractallySys: emit(entropySubm)

anyone-->>FractallySys: triggerEvents()
FractallySys-->>FractallySys: emit(entrRvelStarted)
note right of FractallySys: 2 mintes to reveal entropy
alice->>FractallySys: revealEntropy(entropyRevealMsg)
note right of alice: bob, carol, dave, henry, ivan, jen, kaley, mandy, nancy, opie, pete also reveal

anyone-->>FractallySys: triggerEvents()
note right of FractallySys: triggerEvents here implicit or when all revealEntropy()
FractallySys-->>FractallySys: emit(meetingStart)
note right of FractallySys: Discussion and ranking ensue
alice->>FractallySys: submitConsensus(ranks)
note right of alice: bob, carol, dave, henry, ivan, jen, kaley, mandy, nancy, opie, pete also submit reports
FractallySys->>FractallySys: emit(consensusSubm)
FractallySys->>FractallySys: emit(consensusReached)
anyone-->>FractallySys: triggerEvents()
FractallySys-->>FractallySys: emit(meetingEnd)
note right of alice: People have an hour post-meeting to submit consensus reports
anyone-->>FractallySys: triggerEvents()
FractallySys-->>FractallySys: emit(submissionsEnd)
anyone-->>FractallySys: triggerEvents()
FractallySys-->>FractallySys: emit(respectIssued)
```

## Member Self-Admin Actions
```mermaid
sequenceDiagram
Actor alice

alice->>FractallySys: resign()
note right of FractallySys: NOTE: add crediting balance
FractallySys-->>FractallySys: emit(resigned: alice)

alice->>FractallySys: withdraw()
note right of FractallySys: add TokenSys interaction
FractallySys-->>FractallySys: emit(fundsWithdrawn: <amount>)

alice->>FractallySys: Q: transfer()? No
note right of FractallySys: Q: allow any type of internal transfers or deposits? No
```

## Evicted Member Rejoins the ƒractal - punt
```mermaid
sequenceDiagram
Actor alice
Actor bob

note right of alice: alice is in evicted status
alice->>FractallySys: proposePetition(memo)
note right of alice: Alice requests to be reinstated as a member
note right of FractallySys: Council discuss Alice and approves her addition with a fine

alice->>FractallySys: transfer()
note right of alice: Q: Or should this be a deposit or an explicit payFee()?
FractallySys-->>FractallySys: emit(unevicted: alice)
note right of FractallySys: Q: what should we call this state of being approved to re-enter?

bob->>FractallySys: inviteMember(member: alice)
FractallySys-->>FractallySys: emit(memberAdded: alice)
```
