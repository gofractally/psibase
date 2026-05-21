import { describe, expect, it, vi } from "vitest";

import {
    allOnlineMeshPeersReady,
    beginSignalingGroup,
    ensureGroupChatDataSession,
    syncMeshPeers,
} from "./chat-data-group-orchestrator";
import type {
    ChatDataOrchestratorHost,
    GroupSpaceRun,
} from "./chat-data-session-types";

const buildPeerMock = vi.hoisted(() => {
    class MockPeer {
        readonly sessionId: string;

        readonly selfAccount: string;

        readonly peerAccount: string;

        readonly isInitiator: boolean;

        dataChannelReady = false;

        isDisposed = false;

        negotiationInProgress = false;

        transportUnhealthy = false;

        get needsReconnect(): boolean {
            return this.transportUnhealthy;
        }

        constructor(params: {
            sessionId: string;
            selfAccount: string;
            peerAccount: string;
            isInitiator: boolean;
        }) {
            this.sessionId = params.sessionId;
            this.selfAccount = params.selfAccount;
            this.peerAccount = params.peerAccount;
            this.isInitiator = params.isInitiator;
        }

        dispose(): void {
            this.isDisposed = true;
            this.dataChannelReady = false;
        }
    }

    return { MockPeer };
});

vi.mock("./chat-data-debug", () => ({
    chatDataLog: () => {},
    chatDataRecord: () => {},
    shortSessionId: (id: string) => id,
    shortSpaceId: (id: string) => id,
}));

vi.mock("./chat-data-webrtc-peer", () => ({
    ChatDataWebRtcPeer: buildPeerMock.MockPeer,
}));

describe("allOnlineMeshPeersReady", () => {
    it("is false when only one of two online remotes is ready", () => {
        const run = {
            members: ["alice", "bob", "carol"],
            meshPeers: new Map([
                ["bob", { dataChannelReady: true }],
                ["carol", { dataChannelReady: false }],
            ]),
        } as unknown as GroupSpaceRun;

        const host = {
            getSelf: () => "alice",
            getPeerPresence: () => ({ bob: "online", carol: "online" }),
        } as unknown as ChatDataOrchestratorHost;

        expect(allOnlineMeshPeersReady(host, run)).toBe(false);
    });

    it("is true when every online remote has a ready mesh peer", () => {
        const run = {
            members: ["alice", "bob", "carol"],
            meshPeers: new Map([
                ["bob", { dataChannelReady: true }],
                ["carol", { dataChannelReady: true }],
            ]),
        } as unknown as GroupSpaceRun;

        const host = {
            getSelf: () => "alice",
            getPeerPresence: () => ({ bob: "online", carol: "online" }),
        } as unknown as ChatDataOrchestratorHost;

        expect(allOnlineMeshPeersReady(host, run)).toBe(true);
    });
});

/**
 * Phase A: ensureGroupChatDataSession is intentionally minimal. It (a)
 * creates the run record if absent and (b) dispatches a single `ensure`
 * event to the actor. ALL recovery / negotiation decisions live in the
 * FSM `transition` function (see chat-data-run-state-machine.test.ts).
 * These tests pin that contract.
 */
describe("ensureGroupChatDataSession", () => {
    const SPACE = "space:group-1";
    const SESSION = "wrtc:group-1";
    const MEMBERS = ["alice", "bob", "carol"] as const;

    function makeExistingRun(overrides: Partial<GroupSpaceRun> = {}): GroupSpaceRun {
        const peer = new buildPeerMock.MockPeer({
            sessionId: SESSION,
            selfAccount: "alice",
            peerAccount: "bob",
            isInitiator: true,
        });
        peer.dataChannelReady = true;

        return {
            kind: "group",
            spaceUuid: SPACE,
            members: [...MEMBERS],
            meshPeers: new Map([["bob", peer]]) as unknown as GroupSpaceRun["meshPeers"],
            peerOnlineAtSessionStart: new Map(),
            peerHadOpenDataChannel: new Map(),
            abort: new AbortController(),
            transportRecoveryAttempt: 0,
            hasJoined: true,
            joinSessionRequested: true,
            joinedWelcomeGeneration: 1,
            sessionRoster: new Map(),
            sessionSnapshotEpoch: 0,
            transportLostAt: new Map(),
            lastMeshNudgeMs: 0,
            snapshot: {
                spaceUuid: SPACE,
                phase: "ready",
                sessionId: SESSION,
                dataChannelReady: true,
                meshPeerReady: { bob: true },
            },
            onUpdate: () => {},
            ...overrides,
        };
    }

    it("for an existing run, dispatches an `ensure` event without disturbing peers", () => {
        const existing = makeExistingRun();
        const dispatchRunEventForRun = vi.fn();
        const setRun = vi.fn();
        const deleteRun = vi.fn();
        const runs = new Map([[SPACE, existing]]);

        const host = {
            getSelf: () => "alice",
            getPeerPresence: () => ({ bob: "online", carol: "online" }),
            getRun: (spaceUuid: string) => runs.get(spaceUuid),
            setRun,
            deleteRun,
            dispatchRunEventForRun,
        } as unknown as ChatDataOrchestratorHost;

        ensureGroupChatDataSession(host, SPACE, MEMBERS);

        expect(setRun).not.toHaveBeenCalled();
        expect(deleteRun).not.toHaveBeenCalled();
        expect(existing.meshPeers.get("bob")?.isDisposed).toBe(false);
        expect(dispatchRunEventForRun).toHaveBeenCalledWith(existing, {
            type: "ensure",
        });
    });

    it("for an absent run, creates the run and dispatches `ensure`", () => {
        const dispatchRunEventForRun = vi.fn();
        const setRun = vi.fn();
        const deleteRun = vi.fn();
        const runs = new Map<string, GroupSpaceRun>();

        const host = {
            getSelf: () => "alice",
            getPeerPresence: () => ({ bob: "online", carol: "online" }),
            getRun: (spaceUuid: string) => runs.get(spaceUuid),
            setRun: (spaceUuid: string, run: GroupSpaceRun) => {
                setRun(spaceUuid, run);
                runs.set(spaceUuid, run);
            },
            deleteRun,
            dispatchRunEventForRun,
        } as unknown as ChatDataOrchestratorHost;

        ensureGroupChatDataSession(host, SPACE, MEMBERS);

        expect(setRun).toHaveBeenCalledTimes(1);
        expect(deleteRun).not.toHaveBeenCalled();
        const created = runs.get(SPACE);
        expect(created?.kind).toBe("group");
        expect(created?.snapshot.phase).toBe("idle");
        expect(dispatchRunEventForRun).toHaveBeenCalledWith(created, {
            type: "ensure",
        });
    });

    it("refuses to take over when a DM run already owns the space", () => {
        const dispatchRunEventForRun = vi.fn();
        const setRun = vi.fn();
        const dmRun = { kind: "dm" } as unknown as GroupSpaceRun;
        const runs = new Map<string, GroupSpaceRun>([[SPACE, dmRun]]);
        const host = {
            getSelf: () => "alice",
            getPeerPresence: () => ({ bob: "online", carol: "online" }),
            getRun: (spaceUuid: string) => runs.get(spaceUuid),
            setRun,
            deleteRun: vi.fn(),
            dispatchRunEventForRun,
        } as unknown as ChatDataOrchestratorHost;

        ensureGroupChatDataSession(host, SPACE, MEMBERS);

        expect(setRun).not.toHaveBeenCalled();
        expect(dispatchRunEventForRun).not.toHaveBeenCalled();
    });
});

describe("syncMeshPeers session id drift", () => {
    const SPACE = "space:group-drift";
    const OLD_SESSION = "wrtc:old";
    const NEW_SESSION = "wrtc:new";

    it("replaces a ready peer on the wrong session before creating on the new session", () => {
        const stalePeer = new buildPeerMock.MockPeer({
            sessionId: OLD_SESSION,
            selfAccount: "alice",
            peerAccount: "bob",
            isInitiator: true,
        });
        stalePeer.dataChannelReady = true;

        const syncRunSnapshot = vi.fn();
        const run = {
            kind: "group",
            spaceUuid: SPACE,
            members: ["alice", "bob", "carol"],
            meshPeers: new Map([["bob", stalePeer]]),
            sessionRoster: new Map([
                ["alice", { account: "alice", joinedAt: 1 }],
                ["bob", { account: "bob", joinedAt: 2 }],
            ]),
            peerOnlineAtSessionStart: new Map(),
            peerHadOpenDataChannel: new Map(),
            snapshot: { phase: "ready", sessionId: NEW_SESSION },
            onUpdate: () => {},
        } as unknown as GroupSpaceRun;

        const host = {
            getSelf: () => "alice",
            getSignaling: () => ({}),
            getIceServers: () => [],
            getPeerPresence: () => ({ bob: "online", carol: "offline" }),
            dispatchRunEventForRun: vi.fn(),
            syncRunSnapshot,
        } as unknown as ChatDataOrchestratorHost;

        syncMeshPeers(host, run, NEW_SESSION, "alice");

        expect(stalePeer.isDisposed).toBe(true);
        const live = run.meshPeers.get("bob");
        expect(live).toBeDefined();
        expect(live?.sessionId).toBe(NEW_SESSION);
        expect(live?.isDisposed).toBe(false);
    });

    it("replaces a not-ready peer in a failed transport state", () => {
        const stalePeer = new buildPeerMock.MockPeer({
            sessionId: NEW_SESSION,
            selfAccount: "alice",
            peerAccount: "bob",
            isInitiator: true,
        });
        stalePeer.transportUnhealthy = true;
        Object.defineProperty(stalePeer, "needsReconnect", { get: () => true });

        const syncRunSnapshot = vi.fn();
        const run = {
            kind: "group",
            spaceUuid: SPACE,
            members: ["alice", "bob", "carol"],
            meshPeers: new Map([["bob", stalePeer]]),
            sessionRoster: new Map([
                ["alice", { account: "alice", joinedAt: 1 }],
                ["bob", { account: "bob", joinedAt: 2 }],
            ]),
            peerOnlineAtSessionStart: new Map(),
            peerHadOpenDataChannel: new Map(),
            snapshot: { phase: "signaling", sessionId: NEW_SESSION },
            onUpdate: () => {},
        } as unknown as GroupSpaceRun;

        const host = {
            getSelf: () => "alice",
            getSignaling: () => ({}),
            getIceServers: () => [],
            getPeerPresence: () => ({ bob: "online", carol: "offline" }),
            dispatchRunEventForRun: vi.fn(),
            syncRunSnapshot,
        } as unknown as ChatDataOrchestratorHost;

        syncMeshPeers(host, run, NEW_SESSION, "alice");

        expect(stalePeer.isDisposed).toBe(true);
        const live = run.meshPeers.get("bob");
        expect(live).toBeDefined();
        expect(live).not.toBe(stalePeer);
    });
});

describe("beginSignalingGroup welcome refresh", () => {
    const SPACE = "space:group-1";
    const SESSION = "wrtc:group-1";

    it("clears stale mesh legs on welcome drift when no data channel is open", () => {
        const stalePeer = new buildPeerMock.MockPeer({
            sessionId: SESSION,
            selfAccount: "alice",
            peerAccount: "bob",
            isInitiator: true,
        });

        const joinSession = vi.fn();
        const run = {
            kind: "group",
            spaceUuid: SPACE,
            members: ["alice", "bob", "carol"],
            meshPeers: new Map([["bob", stalePeer]]),
            sessionRoster: new Map([
                ["alice", { account: "alice", joinedAt: 1 }],
                ["bob", { account: "bob", joinedAt: 2 }],
            ]),
            hasJoined: true,
            joinSessionRequested: true,
            joinedWelcomeGeneration: 1,
            peerOnlineAtSessionStart: new Map(),
            peerHadOpenDataChannel: new Map(),
            transportRecoveryAttempt: 0,
            sessionSnapshotEpoch: 1,
            transportLostAt: new Map(),
            lastMeshNudgeMs: 0,
            snapshot: { phase: "signaling", sessionId: SESSION },
            onUpdate: () => {},
        } as unknown as GroupSpaceRun;

        const host = {
            getSelf: () => "alice",
            getRealtime: () => ({ welcomeGeneration: 2 }),
            getSignaling: () => ({ joinSession }),
            getIceServers: () => [],
            getPeerPresence: () => ({ bob: "online", carol: "online" }),
            dispatchRunEventForRun: vi.fn(),
            syncRunSnapshot: vi.fn(),
        } as unknown as ChatDataOrchestratorHost;

        beginSignalingGroup(host, run, SESSION, "alice");

        expect(stalePeer.isDisposed).toBe(true);
        expect(joinSession).toHaveBeenCalledWith(SESSION);
        expect(run.hasJoined).toBe(false);
        expect(run.joinSessionRequested).toBe(true);
        expect(run.joinedWelcomeGeneration).toBe(2);
    });

    it("re-joins on welcome generation drift without disposing live mesh peers", () => {
        const peer = new buildPeerMock.MockPeer({
            sessionId: SESSION,
            selfAccount: "alice",
            peerAccount: "bob",
            isInitiator: true,
        });
        peer.dataChannelReady = true;

        const joinSession = vi.fn();
        const syncRunSnapshot = vi.fn();
        const run = {
            kind: "group",
            spaceUuid: SPACE,
            members: ["alice", "bob", "carol"],
            meshPeers: new Map([["bob", peer]]),
            sessionRoster: new Map([
                ["alice", 0],
                ["bob", 1],
                ["carol", 2],
            ]),
            hasJoined: true,
            joinSessionRequested: true,
            joinedWelcomeGeneration: 1,
            peerOnlineAtSessionStart: new Map(),
            peerHadOpenDataChannel: new Map(),
            transportRecoveryAttempt: 0,
            sessionSnapshotEpoch: 1,
            transportLostAt: new Map(),
            lastMeshNudgeMs: 0,
            snapshot: { phase: "ready", sessionId: SESSION },
            onUpdate: () => {},
        } as unknown as GroupSpaceRun;

        const host = {
            getSelf: () => "alice",
            getRealtime: () => ({ welcomeGeneration: 2 }),
            getSignaling: () => ({ joinSession }),
            getIceServers: () => [],
            getPeerPresence: () => ({ bob: "online", carol: "online" }),
            syncRunSnapshot,
        } as unknown as ChatDataOrchestratorHost;

        beginSignalingGroup(host, run, SESSION, "alice");

        expect(joinSession).toHaveBeenCalledWith(SESSION);
        expect(run.joinedWelcomeGeneration).toBe(1);
        expect(run.hasJoined).toBe(false);
        expect(run.joinSessionRequested).toBe(true);
        expect(peer.isDisposed).toBe(false);
        expect(syncRunSnapshot).toHaveBeenCalled();
    });
});
