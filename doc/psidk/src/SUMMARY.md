# psidk

- [Introduction](README.md)

- [Specifications](specifications/README.md)

  - [Blockchain](specifications/blockchain/README.md)
    - [TaPoS](specifications/blockchain/tapos.md)
    - [Smart authorization](specifications/blockchain/smart-authorization.md)
    - [Database](specifications/blockchain/database.md)
    - [Validation](specifications/blockchain/validation.md)
    - [Wasm runtime](specifications/blockchain/wasm-runtime.md)
    - [Entry points](specifications/blockchain/entry-points.md)
    - [Peer consensus algorithms](specifications/blockchain/peer-consensus/README.md)
      - [CFT](specifications/blockchain/peer-consensus/cft.md)
      - [BFT](specifications/blockchain/peer-consensus/bft.md)
      - [Joint Consensus](specifications/blockchain/peer-consensus/joint-consensus.md)
    - [Synchronization](specifications/blockchain/synchronization.md)
    - [Snapshots](specifications/blockchain/snapshots.md)
  - [App architecture](specifications/app-architecture/README.md)
    - [Events](specifications/app-architecture/events.md)
    - [Plugins](specifications/app-architecture/plugins.md)
    - [Services](specifications/app-architecture/services.md)
    - [Supervisor](specifications/app-architecture/supervisor.md)
  - [High-level concepts]()
    - [User onboarding](specifications/concepts/user-onboarding.md)
  - [Data formats]()
    - [Account numbers](specifications/data-formats/account-numbers.md)
    - [JSON](specifications/data-formats/json.md)
    - [Schema](specifications/data-formats/schema.md)
    - [fracpack](specifications/data-formats/fracpack.md)
    - [App Packages](specifications/data-formats/package.md)

- [Development guides](development/README.md)

  - [Services](development/services/README.md)
    - [Action scripts](development/services/action-scripts.md)
    - [Standards](development/services/standards.md)
    - [WebAssembly](development/services/webassembly.md)
    - [C++](development/services/cpp-service/README.md)
      - [Environment setup](development/services/cpp-service/setup.md)
      - [Basic Service](development/services/cpp-service/basic/README.md)
      - [Minimal UI](development/services/cpp-service/minimal-ui/README.md)
      - [Calling Others](development/services/cpp-service/calling/README.md)
      - [Reference]()
        - [Services and Events](development/services/cpp-service/reference/services-events.md)
        - [Table](development/services/cpp-service/reference/table.md)
        - [Web Services](development/services/cpp-service/reference/web-services.md)
        - [Magic Numbers](development/services/cpp-service/reference/magic-numbers.md)
        - [Native Functions](development/services/cpp-service/reference/native-functions.md)
        - [System Functions](development/services/cpp-service/reference/system.md)
        - [CMake Support](development/services/cpp-service/reference/cmake.md)
    - [Rust](development/services/rust-service/README.md)
      - [Environment setup](development/services/rust-service/setup.md)
      - [Basic Service](development/services/rust-service/basic/README.md)
      - [Testing Services](development/services/rust-service/testing.md)
      - [Building Packages](development/services/rust-service/package.md)
      - [Calling Others](development/services/rust-service/calling.md)
      - [Minimal UI](development/services/rust-service/minimal-ui.md)
      - [Tables](development/services/rust-service/tables.md)
      - [GraphQL](development/services/rust-service/graphql.md)
      - [Initializing Services](development/services/rust-service/pre-action.md)
      - [Reference]()
        - [Web Services](development/services/rust-service/reference/web-services.md)
  - [Plugins]()
  - [Front-ends](development/front-ends/README.md)
    - [User onboarding]()
    - [Reference]()
      - [External script](development/front-ends/reference/external.md)
      - [HTTP requests](development/front-ends/reference/http-requests.md)
      - [JS libraries](development/front-ends/reference/js-libraries.md)

- [Running infrastructure](run-infrastructure/README.md)

  - [Installation]()
    - [Native binaries]()
    - [Docker containers]()
  - [Administration](run-infrastructure/administration.md)
  - [Command-line utilities](run-infrastructure/cli/README.md)
    - [psibase](run-infrastructure/cli/psibase.md)
      - [psibase-create-snapshot](run-infrastructure/cli/psibase-create-snapshot.md)
      - [psibase-load-snapshot](run-infrastructure/cli/psibase-load-snapshot.md)
    - [psinode](run-infrastructure/cli/psinode.md)
  - [Configuration]()
    - [HTTPS](run-infrastructure/configuration/https.md)
    - [Logging](run-infrastructure/configuration/logging.md)

- [Default apps](default-apps/README.md)

  - [accounts](default-apps/accounts.md)
  - [x-admin](default-apps/x-admin.md)
  - [auth-sig](default-apps/auth-sig.md)
  - [common-api](default-apps/common-api.md)
  - [cpu-limit]()
  - [docs](default-apps/docs.md)
  - [events](default-apps/events.md)
  - [explorer]()
  - [invite](default-apps/invite.md)
  - [nft]()
  - [producers]()
  - [http-server](default-apps/http-server.md)
  - [sites](default-apps/sites.md)
  - [setcode](default-apps/setcode.md)
  - [staged-tx](default-apps/staged-tx.md)
  - [symbol]()
  - [tokens]()
  - [transact](default-apps/transact.md)
  - [verify-sig]()

- [Contributing guide](contribute/README.md)
