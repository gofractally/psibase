## Members Participating in Weekly Meeting
```mermaid
sequenceDiagram
FractallySys->>FractallySys: emit(checkinStarted)
alice->>FractallySys: checkin(entropy)
note right of alice: bob, carol, dave, henry, ivan, jen, kaley, mandy, nancy, opie, pete also check in
FractallySys->>FractallySys: emit(entropySubmitted)

FractallySys->>FractallySys: emit(entropyRevealStarted)
alice->>FractallySys: revealEntropy(entropyRevealMsg)
note right of alice: bob, carol, dave, henry, ivan, jen, kaley, mandy, nancy, opie, pete also reveal

FractallySys->>FractallySys: emit(meetingStarted)
note right of FractallySys: Discussion and ranking ensue
alice->>FractallySys: submitConsensus(ranks)
note right of alice: bob, carol, dave, henry, ivan, jen, kaley, mandy, nancy, opie, pete also submit reports
FractallySys->>FractallySys: emit(meetingEnded)
note right of alice: People have an hour post-meeting to submit consensus reports
FractallySys->>FractallySys: emit(submissionsEnded)
```
