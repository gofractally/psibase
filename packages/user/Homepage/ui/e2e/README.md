# Homepage UI · End-to-End tests (`packages/user/Homepage/ui/e2e`)

Playwright specs that run Chromium against a real psibase chain and log in via
the Accounts plugin UI (create-account flow).

## Layout

```
e2e/
├── playwright.config.ts
├── global-setup.ts / global-teardown.ts
├── lib/                 # chain boot, auth UI, chat helpers, churn tooling
├── fixtures/chain.ts
└── tests/               # *.spec.ts
```

## Chain lifecycle

`global-setup` boots a fresh chain unless `PSIBASE_E2E_EXTERNAL_CHAIN=1`.
If port 8080 is already in use, setup **aborts** with instructions to stop the
running chain.

Boots **DevDefault**, then reinstalls **Homepage**, **Chat**, and **XWebRtcSig**
from `build/share/psibase/packages` so the chain serves freshly built artifacts.

## Running

```bash
yarn workspace @psibase/homepage-ui e2e
yarn workspace @psibase/homepage-ui e2e:headed
```

Reuse an already-running chain:

```bash
PSIBASE_E2E_EXTERNAL_CHAIN=1 yarn workspace @psibase/homepage-ui e2e
```

### Notable specs

| Spec | Covers |
|------|--------|
| `chat-dm-pending-flush-on-rejoin` | Queued DM after recipient left, then rejoined |
| `chat-dm-send-before-peer-join` | Sender messages before receiver opens DM |
| `chat-multi-conversation-churn` | DM → DM → group without leaving Chat |
| `chat-group-three-party` | Three online before group send |
| `chat-group-offline-member-catchup` | Member closed browser, then rejoins |
| `chat-three-party-online-offline-flow` | Scripted DM pending + group stagger |
| `chat-group-three-party-random` | Opt-in random churn (`PSIBASE_E2E_RANDOM_CHURN_RUNS`) |
| Meet `meet-*.spec.ts` | DM/group A/V call flows |

### Random churn (opt-in)

```bash
yarn workspace @psibase/homepage-ui e2e:random-churn:mesh
yarn workspace @psibase/homepage-ui e2e:random-churn:stress
```

Useful env vars: `PSIBASE_E2E_RANDOM_CHURN_RUNS`, `PSIBASE_E2E_RANDOM_CHURN_SEED`,
`PSIBASE_E2E_CHURN_MESH_SETTLE_MS`, `PSIBASE_E2E_RANDOM_CHURN_TIMEOUT_SEC`,
`PSIBASE_E2E_RANDOM_CHURN_STALL_SEC`. On failure, logs include `[churn-trace]`,
`[random-churn-diag]`, and transport snapshots via `__chatTransportDebug`.

## Login flow

Each browser context creates a fresh account through the Accounts plugin
(create → save private key → confirm import), then navigates to `/chat` /
`/contacts`. Rejoin specs use `loginExistingAccountViaUi` with the saved key.

If a run is killed mid-flight, the next `yarn e2e` cleans leftover psinode via
`cleanupStaleChainFromDisk()` in `globalSetup`.

## Notes

- Account names are fixed per spec; use a **fresh chain** per run.
- Both users add each other as Contacts before DM (Chat policy).
- WebRTC delivery is async; specs allow up to 90s for message assertions.
