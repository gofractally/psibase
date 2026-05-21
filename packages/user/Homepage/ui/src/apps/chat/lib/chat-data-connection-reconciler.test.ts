import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    ensureConnection,
    getConnection,
    releaseAllConnections,
    releaseConnection,
} from "./chat-data-connection-reconciler";
import type { ChatDataPeerHandlers } from "./chat-data-webrtc-peer";
import type {
    ChatDataOrchestratorHost,
    DmSpaceRun,
    GroupSpaceRun,
    SpaceRun,
} from "./chat-data-session-types";

vi.mock("./chat-data-debug", () => ({
    chatDataLog: () => {},
    chatDataRecord: () => {},
    shortSessionId: (id: string) => id,
    shortSpaceId: (id: string) => id,
}));

const buildPeerMock = vi.hoisted(() => {
    const peers: MockPeer[] = [];

    type MockPeerParams = {
        sessionId: string;
        selfAccount: string;
        peerAccount: string;
        isInitiator: boolean;
        handlers?: ChatDataPeerHandlers;
    };

    class MockPeer {
        readonly sessionId: string;

        readonly selfAccount: string;

        readonly peerAccount: string;

        readonly isInitiator: boolean;

        readonly handlers: ChatDataPeerHandlers;

        dataChannelReady = false;

        isDisposed = false;

        negotiationInProgress = false;

        resendOfferCount = 0;

        constructor(params: MockPeerParams) {
            this.sessionId = params.sessionId;
            this.selfAccount = params.selfAccount;
            this.peerAccount = params.peerAccount;
            this.isInitiator = params.isInitiator;
            this.handlers = params.handlers ?? {};
            peers.push(this);
        }

        dispose(): void {
            this.isDisposed = true;
            this.dataChannelReady = false;
        }

        get sendsInitialOffer(): boolean {
            return this.isInitiator;
        }

        get transportUnhealthy(): boolean {
            return false;
        }

        get needsReconnect(): boolean {
            return false;
        }

        resendOffer(): void {
            this.resendOfferCount += 1;
        }
    }

    return { peers, MockPeer };
});

vi.mock("./chat-data-webrtc-peer", () => ({
    ChatDataWebRtcPeer: buildPeerMock.MockPeer,
}));

const SELF = "alice";
const BOB = "bob";
const CAROL = "carol";
const SESSION = "wrtc:p-1";
const SPACE = "space:p-1";

function makeHostStub(
    overrides: Partial<ChatDataOrchestratorHost> = {},
): ChatDataOrchestratorHost {
    const events: Array<{ space: string; event: unknown }> = [];
    const syncCount = { n: 0 };
    const host = {
        getSelf: () => SELF,
        getIceServers: () => null,
        getSignaling: () => ({
            joinSession: vi.fn(),
            leaveSession: vi.fn(),
            signal: vi.fn(),
            participantState: vi.fn(),
        }),
        getPeerPresence: () => ({ [BOB]: "online", [CAROL]: "online" }),
        dispatchRunEventForRun: (run: SpaceRun, event: unknown) =>
            events.push({ space: run.spaceUuid, event }),
        syncRunSnapshot: () => {
            syncCount.n += 1;
        },
        onChatMessage: () => {},
        onChatHistorySync: () => {},
        ...overrides,
    } as unknown as ChatDataOrchestratorHost;
    (host as unknown as Record<string, unknown>).__events = events;
    (host as unknown as Record<string, unknown>).__syncCount = syncCount;
    return host;
}

function makeDmRun(): DmSpaceRun {
    return {
        kind: "dm",
        spaceUuid: SPACE,
        members: [SELF, BOB],
        peerAccount: BOB,
        peerWasOnlineAtSessionStart: true,
        abort: new AbortController(),
        transportRecoveryAttempt: 0,
        snapshot: {
            spaceUuid: SPACE,
            phase: "signaling",
            sessionId: SESSION,
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
}

function makeGroupRun(): GroupSpaceRun {
    return {
        kind: "group",
        spaceUuid: SPACE,
        members: [SELF, BOB, CAROL],
        meshPeers: new Map(),
        peerOnlineAtSessionStart: new Map([
            [BOB, true],
            [CAROL, true],
        ]),
        peerHadOpenDataChannel: new Map([
            [BOB, false],
            [CAROL, false],
        ]),
        abort: new AbortController(),
        transportRecoveryAttempt: 0,
        snapshot: {
            spaceUuid: SPACE,
            phase: "signaling",
            sessionId: SESSION,
            dataChannelReady: false,
        },
        hasJoined: false,
        joinSessionRequested: false,
        joinedWelcomeGeneration: 0,
        sessionRoster: new Map(),
        sessionSnapshotEpoch: 0,
        transportLostAt: new Map(),
        lastMeshNudgeMs: 0,
        onUpdate: () => {},
    };
}

beforeEach(() => {
    buildPeerMock.peers.length = 0;
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe("ConnectionReconciler — DM and group share the same lifecycle", () => {
    it("ensureConnection creates a peer with polite/impolite derived from account ordering", () => {
        const host = makeHostStub();
        const run = makeDmRun();

        const peer = ensureConnection(host, run, SESSION, SELF, BOB);
        expect(peer).not.toBeNull();
        expect(buildPeerMock.peers).toHaveLength(1);
        // SELF=alice, BOB=bob → alice < bob → impolite (isInitiator=true)
        expect(buildPeerMock.peers[0]!.isInitiator).toBe(true);
        expect(run.peer).toBe(peer);
    });

    it("ensureConnection is idempotent: second call reuses the existing peer", () => {
        const host = makeHostStub();
        const run = makeDmRun();

        const first = ensureConnection(host, run, SESSION, SELF, BOB);
        const second = ensureConnection(host, run, SESSION, SELF, BOB);
        expect(second).toBe(first);
        expect(buildPeerMock.peers).toHaveLength(1);
    });

    it("DM: does not rebuild when initiator role drifts during negotiation", () => {
        const host = makeHostStub();
        const run = makeDmRun();
        run.sessionRoster.set(SELF, { account: SELF, joinedAt: 100 });
        const first = ensureConnection(host, run, SESSION, SELF, BOB);
        expect(first!.sendsInitialOffer).toBe(true);

        (first as unknown as { negotiationInProgress: boolean }).negotiationInProgress =
            true;
        run.sessionRoster.set(BOB, { account: BOB, joinedAt: 200 });
        const second = ensureConnection(host, run, SESSION, SELF, BOB);
        expect(second).toBe(first);
        expect(first!.isDisposed).toBe(false);
        expect(buildPeerMock.peers).toHaveLength(1);
    });

    it("group: rebuilds when roster completion changes initiator role before DC open", () => {
        const host = makeHostStub();
        const run = makeGroupRun();
        run.sessionRoster.set(SELF, { account: SELF, joinedAt: 100 });
        const first = ensureConnection(host, run, SESSION, SELF, CAROL);
        expect(first!.sendsInitialOffer).toBe(true);

        run.sessionRoster.set(CAROL, { account: CAROL, joinedAt: 200 });
        const second = ensureConnection(host, run, SESSION, SELF, CAROL);
        expect(second).not.toBe(first);
        expect(first!.isDisposed).toBe(true);
        expect(second!.sendsInitialOffer).toBe(false);
        expect(buildPeerMock.peers).toHaveLength(2);
    });

    it("group: resends offer when re-ensuring a negotiating initiator without DC", () => {
        const host = makeHostStub();
        const run = makeGroupRun();
        run.sessionRoster.set(CAROL, { account: CAROL, joinedAt: 1 });
        run.sessionRoster.set(SELF, { account: SELF, joinedAt: 2 });
        const peer = ensureConnection(host, run, SESSION, SELF, CAROL)!;
        expect(peer.sendsInitialOffer).toBe(true);
        (peer as unknown as { negotiationInProgress: boolean }).negotiationInProgress =
            true;
        ensureConnection(host, run, SESSION, SELF, CAROL);
        expect(
            (peer as unknown as { resendOfferCount: number }).resendOfferCount,
        ).toBe(1);
        expect(peer.isDisposed).toBe(false);
    });

    it("ensureConnection rebuilds when sessionId changes (rejoin path)", () => {
        const host = makeHostStub();
        const run = makeDmRun();

        const first = ensureConnection(host, run, SESSION, SELF, BOB);
        const second = ensureConnection(host, run, "wrtc:new-session", SELF, BOB);
        expect(second).not.toBe(first);
        expect(first!.isDisposed).toBe(true);
        expect(buildPeerMock.peers).toHaveLength(2);
        expect(run.peer).toBe(second);
    });

    it("ensureConnection rebuilds when existing peer was disposed externally", () => {
        const host = makeHostStub();
        const run = makeDmRun();

        const first = ensureConnection(host, run, SESSION, SELF, BOB);
        first!.dispose();
        const second = ensureConnection(host, run, SESSION, SELF, BOB);
        expect(second).not.toBe(first);
        expect(buildPeerMock.peers).toHaveLength(2);
    });

    it("ensureConnection on a group run writes into meshPeers", () => {
        const host = makeHostStub();
        const run = makeGroupRun();

        const bobPeer = ensureConnection(host, run, SESSION, SELF, BOB);
        const carolPeer = ensureConnection(host, run, SESSION, SELF, CAROL);
        expect(run.meshPeers.get(BOB)).toBe(bobPeer);
        expect(run.meshPeers.get(CAROL)).toBe(carolPeer);
        expect(buildPeerMock.peers).toHaveLength(2);
    });

    it("getConnection unifies the DM and group lookups", () => {
        const host = makeHostStub();
        const dm = makeDmRun();
        const group = makeGroupRun();
        ensureConnection(host, dm, SESSION, SELF, BOB);
        ensureConnection(host, group, SESSION, SELF, BOB);
        expect(getConnection(dm, BOB)).toBe(dm.peer);
        expect(getConnection(group, BOB)).toBe(group.meshPeers.get(BOB));
        // DM only knows its single remote.
        expect(getConnection(dm, CAROL)).toBeNull();
    });

    it("releaseConnection disposes the peer and clears the slot", () => {
        const host = makeHostStub();
        const dm = makeDmRun();
        const peer = ensureConnection(host, dm, SESSION, SELF, BOB);
        releaseConnection(host, dm, BOB, "test");
        expect(peer!.isDisposed).toBe(true);
        expect(dm.peer).toBeNull();

        const group = makeGroupRun();
        const gPeer = ensureConnection(host, group, SESSION, SELF, BOB);
        releaseConnection(host, group, BOB, "test");
        expect(gPeer!.isDisposed).toBe(true);
        expect(group.meshPeers.has(BOB)).toBe(false);
    });

    it("releaseAllConnections wipes every peer for both DM and group runs", () => {
        const host = makeHostStub();
        const dm = makeDmRun();
        const dmPeer = ensureConnection(host, dm, SESSION, SELF, BOB);
        releaseAllConnections(dm);
        expect(dmPeer!.isDisposed).toBe(true);
        expect(dm.peer).toBeNull();

        const group = makeGroupRun();
        const bobPeer = ensureConnection(host, group, SESSION, SELF, BOB);
        const carolPeer = ensureConnection(host, group, SESSION, SELF, CAROL);
        releaseAllConnections(group);
        expect(bobPeer!.isDisposed).toBe(true);
        expect(carolPeer!.isDisposed).toBe(true);
        expect(group.meshPeers.size).toBe(0);
    });

    it("DM peer-level onFailed dispatches `failed` (kills the whole DM run)", () => {
        const events: Array<{ event: unknown }> = [];
        const host = makeHostStub({
            dispatchRunEventForRun: (_run, event) => events.push({ event }),
        });
        const dm = makeDmRun();
        ensureConnection(host, dm, SESSION, SELF, BOB);
        const mockPeer = buildPeerMock.peers.at(-1)!;
        mockPeer.handlers.onFailed?.("ice failed");
        expect(events).toContainEqual({
            event: { type: "failed", detail: "ice failed" },
        });
    });

    it("Group peer-level onFailed dispatches `peerLost` (keeps the mesh alive)", () => {
        const events: Array<{ event: unknown }> = [];
        const host = makeHostStub({
            dispatchRunEventForRun: (_run, event) => events.push({ event }),
        });
        const group = makeGroupRun();
        ensureConnection(host, group, SESSION, SELF, BOB);
        const mockBob = buildPeerMock.peers.at(-1)!;
        mockBob.handlers.onFailed?.("ice failed");
        expect(events).toContainEqual({
            event: {
                type: "peerLost",
                remoteAccount: BOB,
                detail: "ice failed",
            },
        });
    });
});
