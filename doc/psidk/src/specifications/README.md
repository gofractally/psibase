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
  | .---.   .---. |<------>| .---.   .---. |
  | | 1 |<->| 2 | |        | | 1 |<->| 2 | |
  | '---'   '---' |        | '---'   '---' |
  +---------------+        +---------------+
 /// ___________ \\\      /// ___________ \\\
'-------------------'    '-------------------'
        User 1                   User 2
```

The diagram above shows the various components of a psibase network. A blockchain is used to synchronize data across the network (BFT or CFT [consensus mechanism](./blockchain/peer-consensus/README.md)), stateful web [services](./app-architecture/services.md) that handle HTTP requests to serve user interfaces, applications that interact with each other through [plugins](./app-architecture/plugins.md) on the *client-side*, and users who can peer directly (using [WebRTC](https://webrtc.org/)) to each other with no server middleman.

Ultimately, psibase is a protocol that defines decentralized app hosting infrastucture. Reference implementations may imperfectly instantiate any particular specification, and there are currently no reference implementations that instantiate the complete psibase protocol.

# Competing implementations

This separation of protocol from its reference implementations allows for the development of the specifications to be done independently from any implementation. Furthermore, multiple competing protocol implementations could arise, providing additional choice to any ecosystems relying on the psibase protocol, and decreasing the impact of any errors in a particular implementation.
