# Homepage UI · End-to-End tests

These specs run real Chromium against a real psibase chain and log in via the
**Accounts plugin UI** (create-account flow, option 2).

## Layout

```
e2e/
├── playwright.config.ts
├── global-setup.ts / global-teardown.ts
├── lib/
│   ├── chain-boot.ts      # spawn psinode, boot, install Homepage + Chat
│   ├── auth-ui.ts         # createAccountViaUi / loginExistingAccountViaUi
│   ├── chat-ui.ts         # contacts, DM, send, assert message
│   ├── setup-three-party.ts  # shared 3-account + contact graph helper
│   └── diagnostics.ts     # attachDiagnostics for E2E triage logging
├── fixtures/chain.ts
└── tests/
    ├── chain-boot.spec.ts
    ├── chat-dm-first-send.spec.ts
    ├── chat-dm-send-before-peer-join.spec.ts
    ├── chat-multi-conversation-churn.spec.ts
    ├── chat-dm-pending-flush-on-rejoin.spec.ts
    ├── chat-first-dm-message.spec.ts
    ├── chat-group-three-party.spec.ts
    ├── chat-group-roundtrip-three-party.spec.ts
    ├── chat-group-offline-member-catchup.spec.ts
    ├── chat-three-party-online-offline-flow.spec.ts  # scripted DM pending + group stagger
    ├── chat-group-three-party-random.spec.ts         # opt-in: PSIBASE_E2E_RANDOM_CHURN_RUNS
    ├── chat-group-gaps.spec.ts
    ├── chat-group-mesh-stability.spec.ts
    ├── chat-group-partial-contacts.spec.ts
    └── chat-ws-survives-renavigation.spec.ts
```

## Chain lifecycle

`global-setup` boots a fresh chain unless `PSIBASE_E2E_EXTERNAL_CHAIN=1`.
If port 8080 is already in use, setup **aborts** with instructions to stop
the running chain (`cancel_chain` MCP tool or `kill` the pid).

Boots **DevDefault**, then reinstalls **Homepage**, **Chat**, and **XWebRtcSig**
(from `build/share/psibase/packages`) so the chain serves the freshly built
artifacts.

## Running

```bash
yarn workspace @psibase/homepage-ui e2e
yarn workspace @psibase/homepage-ui e2e:headed   # watch the UI login flow
```

### Coverage map (on/offline + pending)

| Spec | What it covers |
|------|----------------|
| `chat-dm-pending-flush-on-rejoin` | Queued DM after bob opened DM once, then left |
| `chat-dm-send-before-peer-join` | Sender messages before receiver opens DM (H19 regression) |
| `chat-multi-conversation-churn` | DM bob → DM carol → group (no leave Chat); H20 reconnect |
| `chat-first-dm-message` / `chat-dm-first-send` | First DM / both online |
| `chat-group-three-party` | All three online before any group send |
| `chat-group-offline-member-catchup` | One member browser closed, rejoin |
| **`chat-three-party-online-offline-flow`** | **Your (a)–(d) script**: DM while bob offline → group while bob online → carol late join |
| `chat-group-app-churn` | Repeated home↔chat on all three + bob offline |

Manual PR stress (`chat-group-three-party-random`, skipped unless env is set):

- **2 iterations** by default (`PSIBASE_E2E_RANDOM_CHURN_RUNS`, wired by `e2e:random-churn`)
- **Fresh chain per iteration** (kill psinode, boot new db, new accounts)
- **Alice browser reset each iteration** (`resetPageForFreshChain`: clear cookies/storage — chain wipe alone does not reset Playwright session)
- **30 steps per iteration** — phased offline-first by default:
  - steps 0–7: Alice solo (Bob/Carol contexts closed)
  - step 8: Bob rejoin + pending flush
  - steps 9–15: Alice + Bob (Carol offline)
  - step 16: Carol rejoin + pending flush
  - steps 17–28: full three-party random mix
  - step 29: mandatory final group send
- Pending delivery: `expectPendingOutboundMessage` on send-to-offline; flush on rejoin via `assertPendingDeliveredForPair` / `expectThreadMessage`
- Legacy pure-random plan: `PSIBASE_E2E_RANDOM_CHURN_LEGACY_PLAN=1` (decaf / wedge scripts)
- Default seed `0xdecafbad` (`PSIBASE_E2E_RANDOM_CHURN_SEED` to override)

```bash
# Mesh-paced (default 3s settle after signaling steps): must pass all 30 steps
yarn workspace @psibase/homepage-ui e2e:random-churn:mesh

# Stress (no inter-step settle): runs all 30 steps even on errors; fails at end with summary
yarn workspace @psibase/homepage-ui e2e:random-churn:stress

yarn workspace @psibase/homepage-ui e2e:random-churn:watch
yarn workspace @psibase/homepage-ui e2e:random-churn:watch:mesh

# PSIBASE_E2E_RANDOM_CHURN_SPEED=mesh|stress (default stress)
# PSIBASE_E2E_CHURN_MESH_SETTLE_MS — after group/home/DM/offline steps (mesh default 3000)
# PSIBASE_E2E_CHURN_INTER_STEP_MS — gap between planner steps (mesh default 400)
# PSIBASE_E2E_RANDOM_CHURN_STRICT=1 — fail on first step error (mesh default on)
# Hard wall clock: PSIBASE_E2E_RANDOM_CHURN_TIMEOUT_SEC (stress 1800s, mesh watch 1200s).
# Pause after leaving Chat before re-open: PSIBASE_E2E_CHURN_HOME_DELAY_MS (mesh 1500, stress 1000).

Wedge diagnosis on decaf (steps 0–10 mesh speed, 11–13 human-paced, no browser recycle):

```bash
yarn workspace @psibase/homepage-ui e2e:random-churn:diag:wedge
# PSIBASE_E2E_RANDOM_CHURN_DISABLE_RECYCLE=1
# PSIBASE_E2E_RANDOM_CHURN_DIAG_STEPS=11-13
# PSIBASE_E2E_RANDOM_CHURN_DIAG_STOP_AT=13
# PSIBASE_E2E_RANDOM_CHURN_HUMAN_MS=3000
```

On failure, logs include `[churn-trace]` (product), `[random-churn-diag] dump`, and `[random-churn] transport-snapshot` (v2 peer states + pending outbox via `__chatTransportV2Debug.snapshot` / `deliverySnapshot`). Product ring buffer also records `peer-registry-state`, `pending-flush-skip`, and `pending-flush-remote` in `[chat-data]`.
# Stall kill: no completed step for PSIBASE_E2E_RANDOM_CHURN_STALL_SEC (default 120s).
# After a step FAIL, kills if log idle PSIBASE_E2E_RANDOM_CHURN_FAIL_IDLE_SEC (default 60s).
# Per-step budget: PSIBASE_E2E_RANDOM_CHURN_STEP_MS (default 90000).
yarn workspace @psibase/homepage-ui e2e:random-churn
# or: PSIBASE_E2E_RANDOM_CHURN_RUNS=2 PSIBASE_E2E_RANDOM_CHURN_SEED=42 yarn workspace @psibase/homepage-ui e2e e2e/tests/chat-group-three-party-random.spec.ts
```

Reuse an already-running chain:

```bash
PSIBASE_E2E_EXTERNAL_CHAIN=1 yarn workspace @psibase/homepage-ui e2e
```

## Login flow (UI, option 2)

Each browser context creates a fresh account through the Accounts plugin:

1. Open `network.psibase.localhost:8080/` (DevDefault branding host)
2. Wait for auth shell → **Log in** (splash or nav user menu)
3. Supervisor prompt iframe → **Use another account** → **Create account**
4. Create → save private key → confirm import
5. Redirect to `/` → tests navigate to `/chat` / `/contacts`

The pending-flush-on-rejoin spec closes bob's browser context, alice queues a
DM, then bob logs back in with `loginExistingAccountViaUi` using the saved
private key.

### Interrupted runs

If a Playwright run is killed mid-flight (Ctrl+C, OOM, agent timeout),
`globalTeardown` may not run. The next `yarn e2e` invocation automatically
calls `cleanupStaleChainFromDisk()` in `globalSetup` to stop any leftover
psinode from the prior run. Worker processes also register SIGINT/SIGTERM
handlers to tear down the chain when the runner is interrupted.

## Notes

- Account names in specs are fixed per spec and require a **fresh chain** per
  run (global-setup wipes db).
- Both users add each other as **Contacts** before DM (Chat policy).
- WebRTC delivery is async; specs allow up to 90s for message assertions.
