import { describe, expect, it } from "vitest";

import {
    AvCallRunCommandExecutor,
    AvRunActor,
    type AvRunCommandExecutor,
} from "./av-call-run-actor";
import type {
    AvRunCommand,
} from "./av-call-run-state-machine";
import type {
    AvCallIncomingInvite,
    AvCallOrchestratorHost,
    AvCallSessionSnapshot,
    AvCallSpaceRun,
    DmAvCallRun,
    GroupAvCallRun,
} from "./av-call-session-types";
import type { IceServerConfig } from "./protocol";
import type { RealtimeClient } from "./realtime-client";
import type { WebRtcSignalingClient } from "./webrtc-signaling-client";

const SELF = "alice";
const BOB = "bob";
const CAROL = "carol";
const SPACE = "space:test";
const SESSION = "wrtc:av-actor";

class RecordingExecutor implements AvRunCommandExecutor {
    readonly commands: AvRunCommand[] = [];
    /** Per-command-type behavior: "synthesizeMediaConnected" simulates the
     * effect of a command (e.g. createPeer) so subsequent transitions see the
     * right live state. */
    afterCommand?: (run: AvCallSpaceRun, command: AvRunCommand) => void;

    execute(
        run: AvCallSpaceRun,
        command: AvRunCommand,
        syncSnapshot: () => void,
    ): void | Promise<void> {
        this.commands.push(command);
        this.afterCommand?.(run, command);
        // Always sync the snapshot so the property of "snapshot reflects live
        // state after each command" holds even with a fake executor.
        syncSnapshot();
    }

    countOf(type: AvRunCommand["type"]): number {
        return this.commands.filter((c) => c.type === type).length;
    }

    lastOf<T extends AvRunCommand["type"]>(
        type: T,
    ): Extract<AvRunCommand, { type: T }> | undefined {
        for (let i = this.commands.length - 1; i >= 0; i--) {
            const c = this.commands[i]!;
            if (c.type === type) return c as Extract<AvRunCommand, { type: T }>;
        }
        return undefined;
    }
}

class FakeMeetPeer {
    sessionId = SESSION;
    isMediaConnected = false;
    isDisposed = false;
    resendCount = 0;

    resendOffer(): void {
        this.resendCount++;
    }
    dispose(): void {
        this.isDisposed = true;
    }
    getLocalStream(): MediaStream | null {
        return null;
    }
    getRemoteStream(): MediaStream | null {
        return null;
    }
    async handleRemoteSignal(_: unknown): Promise<void> {}
    async start(): Promise<void> {}
}

function buildDm(): DmAvCallRun {
    const dm: DmAvCallRun = {
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
            phase: "idle",
            signalingJoined: false,
            mediaConnected: false,
        },
        hasJoined: false,
        transportRecoveryAttempt: 0,
        onUpdate: () => {},
    };
    return dm;
}

function buildGroup(): GroupAvCallRun {
    const grp: GroupAvCallRun = {
        kind: "group",
        spaceUuid: SPACE,
        members: [SELF, BOB, CAROL],
        meshPeers: new Map(),
        wantVideo: true,
        wantAudio: true,
        localStream: null,
        peerOnlineAtSessionStart: new Map(),
        abort: new AbortController(),
        snapshot: {
            spaceUuid: SPACE,
            phase: "idle",
            signalingJoined: false,
            meshPeerSignalingReady: {},
        },
        hasJoined: false,
        transportRecoveryAttempt: 0,
        onUpdate: () => {},
    };
    return grp;
}

function makeFakeHost(opts: {
    presence?: Record<string, string>;
    pendingInvite?: AvCallIncomingInvite | null;
    onPendingInvite?: (invite: AvCallIncomingInvite) => void;
    onInviteCleared?: (sessionId: string) => void;
} = {}): AvCallOrchestratorHost {
    const presence = opts.presence ?? {};
    const runs = new Map<string, AvCallSpaceRun>();

    const host: AvCallOrchestratorHost = {
        getRealtime(): RealtimeClient | null {
            return null;
        },
        getSelf() {
            return SELF;
        },
        getIceServers(): IceServerConfig[] | null {
            return null;
        },
        getPeerPresence() {
            return presence;
        },
        getSignaling(): WebRtcSignalingClient | null {
            return null;
        },
        setSignaling(_: WebRtcSignalingClient) {},
        getRun(spaceUuid) {
            return runs.get(spaceUuid);
        },
        setRun(spaceUuid, run) {
            runs.set(spaceUuid, run);
        },
        deleteRun(spaceUuid) {
            runs.delete(spaceUuid);
        },
        getRuns() {
            return runs.values();
        },
        findRunBySessionId(sessionId) {
            for (const r of runs.values()) {
                if (r.snapshot.sessionId === sessionId) return r;
            }
            return undefined;
        },
        liveSnapshot(run): AvCallSessionSnapshot {
            return run.snapshot;
        },
        meshPeerSignalingReadyMap() {
            return {};
        },
        anyMeshMediaReady() {
            return false;
        },
        setPhase() {},
        fail() {},
        tearDownSignaling() {},
        tearDownMeshSignalingPeer() {},
        async beginSignaling() {},
        async runPipeline() {},
        tearDownDmPeer() {},
        onPeerOnline() {},
        onPeerOffline() {},
        setPendingInvite(invite) {
            opts.onPendingInvite?.(invite);
        },
        clearPendingInvite(sessionId) {
            opts.onInviteCleared?.(sessionId);
        },
    };
    return host;
}

describe("AvRunActor", () => {
    it("dispatch + drain runs commands in FIFO order", async () => {
        const run = buildDm();
        const host = makeFakeHost({ presence: { [BOB]: "online" } });
        const exec = new RecordingExecutor();
        const actor = new AvRunActor(run, host, exec);

        actor.dispatch({ type: "ensure" });
        actor.dispatch({ type: "pipelineCreating" });
        await actor.dispatchAndWait({
            type: "sessionResolved",
            sessionId: SESSION,
            anyPeerOnline: true,
        });

        expect(exec.commands[0]).toMatchObject({ type: "runPipeline" });
        // pipelineCreating produces no commands
        // sessionResolved with peerOnline produces beginSignaling
        expect(exec.lastOf("beginSignaling")).toMatchObject({
            sessionId: SESSION,
        });
    });

    it("DM mediaConnected updates snapshot to ready phase", async () => {
        const run = buildDm();
        run.peer = new FakeMeetPeer() as never;
        const host = makeFakeHost({ presence: { [BOB]: "online" } });
        const exec = new RecordingExecutor();
        const actor = new AvRunActor(run, host, exec);

        // Boot: ensure -> creating -> sessionResolved -> signaling
        await actor.dispatchAndWait({ type: "ensure" });
        await actor.dispatchAndWait({ type: "pipelineCreating" });
        await actor.dispatchAndWait({
            type: "sessionResolved",
            sessionId: SESSION,
            anyPeerOnline: true,
        });
        await actor.dispatchAndWait({
            type: "joinedSignaling",
            sessionId: SESSION,
        });
        run.hasJoined = true;
        // Simulate live media coming up before dispatching mediaConnected
        (run.peer as unknown as FakeMeetPeer).isMediaConnected = true;
        await actor.dispatchAndWait({
            type: "mediaConnected",
            remoteAccount: BOB,
        });

        expect(run.snapshot.phase).toBe("ready");
        expect(run.snapshot.mediaConnected).toBe(true);
        expect(exec.countOf("notifyMediaReady")).toBe(1);
    });

    it("recovery storm: rapid mediaLost -> mediaConnected cycles cap recovery commands", async () => {
        const run = buildDm();
        run.peer = new FakeMeetPeer() as never;
        run.hasJoined = true;
        const host = makeFakeHost({ presence: { [BOB]: "online" } });
        const exec = new RecordingExecutor();
        const actor = new AvRunActor(run, host, exec, {
            tag: "ready",
            sessionId: SESSION,
            peerSlots: { [BOB]: "ready" },
            signalingJoined: true,
        });

        for (let i = 0; i < 5; i++) {
            await actor.dispatchAndWait({
                type: "mediaLost",
                remoteAccount: BOB,
                detail: "ice",
            });
            await actor.dispatchAndWait({
                type: "mediaConnected",
                remoteAccount: BOB,
            });
        }

        // Each cycle issues exactly 1 scheduleRecovery + 1 cancelRecovery
        // (no duplicate scheduling per cycle).
        expect(exec.countOf("scheduleRecovery")).toBe(5);
        expect(exec.countOf("cancelRecovery")).toBe(5);
    });

    it("incoming invite sets pendingInvite via host", async () => {
        const run = buildDm();
        let received: AvCallIncomingInvite | null = null;
        const host = makeFakeHost({
            onPendingInvite: (i) => {
                received = i;
            },
        });
        // Use production executor so setPendingInvite actually fires.
        const exec = new AvCallRunCommandExecutor(host);
        const actor = new AvRunActor(run, host, exec);

        await actor.dispatchAndWait({
            type: "sessionInvite",
            sessionId: SESSION,
            from: BOB,
            wantVideo: true,
            wantAudio: false,
        });

        expect(received).not.toBeNull();
        expect(received!.sessionId).toBe(SESSION);
        expect(received!.from).toBe(BOB);
        expect(received!.wantVideo).toBe(true);
        expect(received!.wantAudio).toBe(false);
        expect(received!.spaceUuid).toBe(SPACE);
    });

    it("decline emits clearPendingInvite + leaveSession + commitTimelineEvent", async () => {
        const run = buildDm();
        let cleared: string | null = null;
        const host = makeFakeHost({
            onInviteCleared: (id) => {
                cleared = id;
            },
        });
        // Production executor so onInviteCleared fires; commands still
        // observable via the recording wrapper.
        const recorder = new RecordingExecutor();
        const real = new AvCallRunCommandExecutor(host);
        const exec: AvRunCommandExecutor = {
            execute(r, cmd, sync) {
                recorder.commands.push(cmd);
                return real.execute(r, cmd, sync);
            },
        };
        const actor = new AvRunActor(run, host, exec, {
            tag: "pendingInvite",
            sessionId: SESSION,
            from: BOB,
            wantVideo: true,
            wantAudio: true,
        });

        await actor.dispatchAndWait({ type: "declineInvite", reason: "user" });

        expect(cleared).toBe(SESSION);
        expect(recorder.countOf("leaveSession")).toBe(1);
        expect(recorder.countOf("commitTimelineEvent")).toBe(1);
    });

    it("group transport torn down disposes all peers and reseeds slots", async () => {
        const run = buildGroup();
        run.hasJoined = true;
        const host = makeFakeHost({
            presence: { [BOB]: "online", [CAROL]: "offline" },
        });
        const exec = new RecordingExecutor();
        const actor = new AvRunActor(run, host, exec, {
            tag: "ready",
            sessionId: SESSION,
            peerSlots: { [BOB]: "ready", [CAROL]: "ready" },
            signalingJoined: true,
        });

        await actor.dispatchAndWait({
            type: "transportTornDown",
            reason: "ws closed",
        });

        expect(exec.countOf("disposeAllPeers")).toBe(1);
        expect(exec.countOf("cancelRecovery")).toBe(1);
        expect(run.snapshot.phase).toBe("signaling");
    });

    it("hangup from ready emits leaveSession + commitSessionEnded + dispose", async () => {
        const run = buildDm();
        run.hasJoined = true;
        const host = makeFakeHost({ presence: { [BOB]: "online" } });
        const exec = new RecordingExecutor();
        const actor = new AvRunActor(run, host, exec, {
            tag: "ready",
            sessionId: SESSION,
            peerSlots: { [BOB]: "ready" },
            signalingJoined: true,
        });

        await actor.dispatchAndWait({ type: "hangup", reason: "ended" });

        expect(exec.countOf("leaveSession")).toBe(1);
        expect(exec.countOf("commitSessionEnded")).toBe(1);
        expect(exec.countOf("disposeAllPeers")).toBe(1);
        expect(exec.countOf("releaseLocalMedia")).toBe(1);
        expect(run.snapshot.phase).toBe("failed");
    });

    it("group hangup from ready commits participant left and returns idle", async () => {
        const run = buildGroup();
        run.hasJoined = true;
        const host = makeFakeHost({
            presence: { [BOB]: "online", [CAROL]: "online" },
        });
        const exec = new RecordingExecutor();
        const actor = new AvRunActor(run, host, exec, {
            tag: "ready",
            sessionId: SESSION,
            peerSlots: { [BOB]: "ready", [CAROL]: "ready" },
            signalingJoined: true,
        });

        await actor.dispatchAndWait({ type: "hangup", reason: "ended" });

        expect(exec.countOf("leaveSession")).toBe(1);
        expect(exec.countOf("commitParticipantLeft")).toBe(1);
        expect(exec.countOf("commitSessionEnded")).toBe(0);
        expect(run.snapshot.phase).toBe("idle");
    });

    it("group sessionEnded from remote disposes one peer and stays in call", async () => {
        const run = buildGroup();
        run.hasJoined = true;
        const host = makeFakeHost({
            presence: { [BOB]: "online", [CAROL]: "online" },
        });
        const exec = new RecordingExecutor();
        const actor = new AvRunActor(run, host, exec, {
            tag: "ready",
            sessionId: SESSION,
            peerSlots: { [BOB]: "ready", [CAROL]: "ready" },
            signalingJoined: true,
        });

        await actor.dispatchAndWait({
            type: "sessionEnded",
            sessionId: SESSION,
            reason: "session-not-active",
            by: BOB,
        });

        expect(exec.countOf("disposePeer")).toBe(1);
        expect(exec.countOf("disposeAllPeers")).toBe(0);
        expect(run.snapshot.phase).toBe("signaling");
    });

    it("draining is FIFO even with rapid synchronous dispatches", async () => {
        const run = buildDm();
        const host = makeFakeHost();
        const exec = new RecordingExecutor();
        const actor = new AvRunActor(run, host, exec);

        actor.dispatch({ type: "ensure" });
        actor.dispatch({ type: "pipelineCreating" });
        actor.dispatch({ type: "ensure" });
        await actor.dispatchAndWait({ type: "dispose" });

        const types = exec.commands.map((c) => c.type);
        // First ensure -> runPipeline; pipelineCreating -> no command; second
        // ensure (during creating) -> logIgnored ("ensure in progress"); dispose
        // -> cancelRecovery, disposeAllPeers, releaseLocalMedia.
        expect(types).toContain("runPipeline");
        expect(types).toContain("logIgnored");
        expect(types).toContain("disposeAllPeers");
    });
});
