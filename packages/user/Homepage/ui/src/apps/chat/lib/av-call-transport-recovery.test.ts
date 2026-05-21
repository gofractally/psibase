import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AvCallTransportRecoveryManager } from "./av-call-transport-recovery";
import {
    AV_MAX_TRANSPORT_RECOVERY_ATTEMPTS,
    type AvCallOrchestratorHost,
    type AvCallSpaceRun,
    type DmAvCallRun,
} from "./av-call-session-types";
import type { AvRunEvent } from "./av-call-run-state-machine";

const SELF = "alice";
const BOB = "bob";
const SPACE = "space:test";
const SESSION = "wrtc:av";

function buildDm(overrides: Partial<DmAvCallRun> = {}): DmAvCallRun {
    return {
        kind: "dm",
        spaceUuid: SPACE,
        members: [SELF, BOB],
        peerAccount: BOB,
        wantVideo: true,
        wantAudio: true,
        peer: null,
        abort: new AbortController(),
        snapshot: {
            spaceUuid: SPACE,
            phase: "signaling",
            sessionId: SESSION,
            signalingJoined: true,
            mediaConnected: false,
        },
        hasJoined: true,
        transportRecoveryAttempt: 0,
        onUpdate: () => {},
        ...overrides,
    };
}

function makeHost(opts: {
    presence?: Record<string, string>;
    onDispatch?: (run: AvCallSpaceRun, event: AvRunEvent) => void;
}): AvCallOrchestratorHost {
    return {
        getRealtime: () => null,
        getSelf: () => SELF,
        getIceServers: () => null,
        getPeerPresence: () => opts.presence ?? {},
        getSignaling: () => null,
        setSignaling: () => {},
        getRun: () => undefined,
        setRun: () => {},
        deleteRun: () => {},
        getRuns: () => [].values(),
        findRunBySessionId: () => undefined,
        liveSnapshot: (run) => run.snapshot,
        meshPeerSignalingReadyMap: () => ({}),
        anyMeshMediaReady: () => false,
        setPhase: () => {},
        fail: () => {},
        tearDownSignaling: () => {},
        tearDownMeshSignalingPeer: () => {},
        beginSignaling: async () => {},
        runPipeline: async () => {},
        tearDownDmPeer: () => {},
        onPeerOnline: () => {},
        onPeerOffline: () => {},
        setPendingInvite: () => {},
        dispatchRunEventForRun: opts.onDispatch,
    };
}

describe("AvCallTransportRecoveryManager", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("schedules a recovery tick using exponential backoff", () => {
        const mgr = new AvCallTransportRecoveryManager();
        const events: { run: AvCallSpaceRun; event: AvRunEvent }[] = [];
        const run = buildDm();
        const host = makeHost({
            presence: { [BOB]: "online" },
            onDispatch: (r, e) => events.push({ run: r, event: e }),
        });

        mgr.scheduleTransportRecovery(run, host);
        expect(run.transportRecoveryAttempt).toBe(1);

        // Base delay is 2_000ms for attempt 1.
        vi.advanceTimersByTime(1999);
        expect(events).toHaveLength(0);

        vi.advanceTimersByTime(2);
        expect(events).toHaveLength(1);
        expect(events[0]!.event).toMatchObject({
            type: "recoveryTick",
            sessionId: SESSION,
        });
    });

    it("caps attempts and dispatches signalingDeferred when exceeded", () => {
        const mgr = new AvCallTransportRecoveryManager();
        const events: AvRunEvent[] = [];
        const run = buildDm({
            transportRecoveryAttempt: AV_MAX_TRANSPORT_RECOVERY_ATTEMPTS,
        });
        const host = makeHost({
            presence: { [BOB]: "online" },
            onDispatch: (_, e) => events.push(e),
        });

        mgr.scheduleTransportRecovery(run, host);

        expect(run.transportRecoveryAttempt).toBe(0);
        expect(events[0]).toMatchObject({
            type: "signalingDeferred",
            sessionId: SESSION,
        });
    });

    it("dispatches signalingDeferred when DM peer goes offline before tick fires", () => {
        const mgr = new AvCallTransportRecoveryManager();
        const events: AvRunEvent[] = [];
        let presence: Record<string, string> = { [BOB]: "online" };
        const run = buildDm();
        const host = makeHost({
            onDispatch: (_, e) => events.push(e),
        });
        // Override presence dynamically
        host.getPeerPresence = () => presence;

        mgr.scheduleTransportRecovery(run, host);
        presence = { [BOB]: "offline" };
        vi.advanceTimersByTime(2_001);

        expect(events).toEqual([
            { type: "signalingDeferred", sessionId: SESSION },
        ]);
        expect(run.transportRecoveryAttempt).toBe(0);
    });

    it("cancelTransportRecovery clears the timer", () => {
        const mgr = new AvCallTransportRecoveryManager();
        const events: AvRunEvent[] = [];
        const run = buildDm();
        const host = makeHost({
            presence: { [BOB]: "online" },
            onDispatch: (_, e) => events.push(e),
        });

        mgr.scheduleTransportRecovery(run, host);
        mgr.cancelTransportRecovery(run);
        vi.advanceTimersByTime(60_000);

        expect(events).toEqual([]);
    });

    it("dispose clears all timers", () => {
        const mgr = new AvCallTransportRecoveryManager();
        const events: AvRunEvent[] = [];
        const runA = buildDm({ spaceUuid: "space:a" });
        const runB = buildDm({ spaceUuid: "space:b" });
        const host = makeHost({
            presence: { [BOB]: "online" },
            onDispatch: (_, e) => events.push(e),
        });

        mgr.scheduleTransportRecovery(runA, host);
        mgr.scheduleTransportRecovery(runB, host);
        mgr.dispose();
        vi.advanceTimersByTime(60_000);

        expect(events).toEqual([]);
    });
});
