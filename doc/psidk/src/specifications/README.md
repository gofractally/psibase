# Specifications

```svgbob
.-------------------------------------------.
|  +-----+        BFT or CFT       +-----+  |
|  |ψnode|<- - - - - - - - - - - ->|ψnode|  |
|  +-----+            .-.          +-----+  |
|     ^            .-+   |            ^     |
|     :        .--+       '--.        :     |
|     :       |   Blockchain  |       :     |
|     V        '-------------'        V     |
|  +-----+                         +-----+  |
|  |ψnode|<- - - - - - - - - - - ->|ψnode|  |
|  +--.--+                         +--.--+  |
'-----|-------------------------------|-----'
      |                               |
      |HTTP                       HTTP|
      '---.                       .---'
          |                       |
          V                       V
  .---------------. WebRTC .---------------.
  | .---.IAC.---. |<------>| .---.IAC.---. |
  | | 1 |---| 2 | |        | | 1 |---| 2 | |
  | '---'   '---' |        | '---'   '---' |
  +---------------+        +---------------+
 /// ___________ \\\      /// ___________ \\\
'-------------------'    '-------------------'
        User 1                   User 2
```

A blockchain to synchronize data across the community (BFT or CFT [consensus mechanism](./blockchain/peer-consensus/README.md)), stateful web [services](./blockchain/services.md) that handle HTTP requests to serve applications, applications that can talk to each other and share information *client-side* (Inter-App Communication via [App interfaces](./app-architecture/app-interfaces.md)), and users who can peer directly (using [WebRTC](https://webrtc.org/)) to each other with no server middleman.

Ultimately, psibase is a protocol that defines decentralized app hosting infrastucture. Reference implementations may imperfectly instantiate any particular specification, and there are currently no reference implementations that instantiate the complete psibase protocol.

# Competing implementations

This separation of protocol from its reference implementations allows for the development of the specifications to be done independently from any implementation. Furthermore, multiple competing implementations could arise which each attempt to follow the protocol, providing additional choice to any ecosystems relying on the psibase protocol, and decreasing the impact of any system-wide fault in a particular implementation.
