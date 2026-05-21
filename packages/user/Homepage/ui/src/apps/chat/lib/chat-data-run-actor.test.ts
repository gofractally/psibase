import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RunCommand } from "./chat-data-run-state-machine";
import type { ChatDataOrchestratorHost, SpaceRun } from "./chat-data-session-types";

vi.mock("./chat-data-debug", () => ({
    chatDataLog: () => {},
    chatDataRecord: () => {},
    shortSessionId: (id: string) => id,
    shortSpaceId: (id: string) => id,
}));

class RecordingExecutor {
    readonly commands: RunCommand[] = [];

    execute(
        _run: SpaceRun,
        command: RunCommand,
        _sync: () => void,
    ): void {
        this.commands.push(command);
    }
}

function makeHost(): ChatDataOrchestratorHost {
    const run: SpaceRun = {
        kind: "dm",
        spaceUuid: "space:dm",
        members: ["alice", "bob"],
        peerAccount: "bob",
        peerWasOnlineAtSessionStart: true,
        abort: new AbortController(),
        transportRecoveryAttempt: 0,
        snapshot: {
            spaceUuid: "space:dm",
            phase: "idle",
            dataChannelReady: false,
        },
        peer: null,
        hasJoined: false,
        joinSessionRequested: false,
        joinedWelcomeGeneration: 0,
        sessionRoster: new Map(),
        sessionSnapshotEpoch: 0,
        transportLostAt: new Map(),
        lastMeshNudgeMs: 0,
        onUpdate: () => {},
    };
    const host: Partial<ChatDataOrchestratorHost> = {
        getSelf: () => "alice",
        getPeerPresence: () => ({ bob: "online" }),
        getRun: () => run,
        getRuns: function* () {
            yield run;
        },
        liveSnapshot: () => run.snapshot,
        syncRunSnapshot: () => {},
        dispatchRunEventForRun: () => {},
        dispatchRunEventAndWait: async () => {},
    };
    return host as ChatDataOrchestratorHost;
}

describe("RunActor", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("serializes concurrent dispatches through the mailbox", async () => {
        const { RunActor } = await import("./chat-data-run-actor");
        const host = makeHost();
        const run = host.getRun("space:dm")!;
        const executor = new RecordingExecutor();
        const actor = new RunActor(run, host, executor);

        actor.dispatch({ type: "ensure" });
        actor.dispatch({ type: "pipelineCreating" });

        expect(executor.commands.filter((c) => c.type === "runPipeline")).toHaveLength(1);
    });

    it("recovery tick emits beginSignaling once per event", async () => {
        const { RunActor } = await import("./chat-data-run-actor");
        const host = makeHost();
        const run = host.getRun("space:dm")!;
        run.snapshot = {
            ...run.snapshot,
            phase: "signaling",
            sessionId: "wrtc:111",
        };
        const executor = new RecordingExecutor();
        const actor = new RunActor(run, host, executor, {
            tag: "signaling",
            sessionId: "wrtc:111",
            peerSlots: {},
        });

        actor.dispatch({ type: "recoveryTick", sessionId: "wrtc:111" });
        actor.dispatch({ type: "recoveryTick", sessionId: "wrtc:111" });

        expect(
            executor.commands.filter((c) => c.type === "beginSignaling"),
        ).toHaveLength(2);
    });

    it("peerLost schedules a single recovery path", async () => {
        const { RunActor } = await import("./chat-data-run-actor");
        const host = makeHost();
        const run = host.getRun("space:dm")!;
        run.snapshot = {
            ...run.snapshot,
            phase: "signaling",
            sessionId: "wrtc:111",
        };
        const executor = new RecordingExecutor();
        const actor = new RunActor(run, host, executor, {
            tag: "signaling",
            sessionId: "wrtc:111",
            peerSlots: { bob: "ready" },
        });

        actor.dispatch({
            type: "peerLost",
            remoteAccount: "bob",
            detail: "transport lost",
        });

        expect(executor.commands.some((c) => c.type === "disposePeer")).toBe(
            true,
        );
        expect(
            executor.commands.filter((c) => c.type === "scheduleRecovery"),
        ).toHaveLength(1);
    });
});
