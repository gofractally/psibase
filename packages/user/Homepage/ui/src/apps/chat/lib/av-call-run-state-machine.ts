/**
 * Public façade for the Meet Call FSM (v2b: `mediaLegs`). Re-exports the
 * split-out modules so existing imports of `av-call-run-state-machine`
 * keep working unchanged:
 *   - `av-call-run-state-machine-types.ts` — state/context/event/command types
 *   - `av-call-run-state-machine-snapshot.ts` — `deriveAvSnapshot` + selectors
 *   - `av-call-run-state-machine-core.ts` — the `avTransition` reducer table
 */

export type {
    AvDepartedPeers,
    AvPeerSlotState,
    AvRemoteSignalPayload,
    AvRunCommand,
    AvRunContext,
    AvRunEvent,
    AvRunKind,
    AvRunMachineState,
    AvTransitionResult,
} from "./av-call-run-state-machine-types";
export { initialAvRunMachineState } from "./av-call-run-state-machine-types";

export {
    avSnapshotToMachineState,
    deriveAvSnapshot,
    initialAvCallRunSnapshot,
} from "./av-call-run-state-machine-snapshot";

export { avTransition } from "./av-call-run-state-machine-core";
