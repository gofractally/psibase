import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatDataMessageEnvelope, ChatHistorySyncEnvelope } from "./chat-data-envelope";
import type { ChatDataPeerHandlers } from "./chat-data-webrtc-peer";
import type { RealtimeClient, RealtimeHandlers } from "./realtime-client";
import type { ServerRealtimeFrame } from "./realtime-protocol";
import type { SignalKind } from "./webrtc-signaling-client";

vi.mock("./chat-data-debug", () => ({
    chatDataLog: () => {},
    chatDataRecord: () => {},
    shortSessionId: (id: string) => id,
    shortSpaceId: (id: string) => id,
    installChatDataDebugGlobal: () => {},
}));

vi.mock("./chat-api", () => ({
    canonicalChatParticipants: (members: string[]) => [...members].sort(),
    fetchActiveChatDataSession: vi.fn(),
    createChatDataSession: vi.fn(),
    waitForActiveChatDataSession: vi.fn(),
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

        sentMessages: ChatDataMessageEnvelope[] = [];

        sentHistorySyncs: ChatHistorySyncEnvelope[] = [];

        resendOfferCount = 0;

        handleRemoteSignalCalls: Array<{ from?: string; kind: SignalKind }> = [];

        constructor(params: MockPeerParams) {
            this.sessionId = params.sessionId;
            this.selfAccount = params.selfAccount;
            this.peerAccount = params.peerAccount;
            this.isInitiator = params.isInitiator;
            this.handlers = params.handlers ?? {};
            peers.push(this);
        }

        simulateOpen(): void {
            this.dataChannelReady = true;
            this.handlers.onDataChannelOpen?.();
        }

        simulateTransportLost(detail = "transport lost"): void {
            this.dataChannelReady = false;
            this.handlers.onTransportLost?.(detail);
        }

        simulateFailed(detail = "failed"): void {
            this.dataChannelReady = false;
            this.handlers.onFailed?.(detail);
        }

        sendChatMessage(envelope: ChatDataMessageEnvelope): boolean {
            if (this.isDisposed || !this.dataChannelReady) return false;
            this.sentMessages.push(envelope);
            return true;
        }

        sendHistorySync(envelope: ChatHistorySyncEnvelope): boolean {
            if (this.isDisposed || !this.dataChannelReady) return false;
            this.sentHistorySyncs.push(envelope);
            return true;
        }

        async handleRemoteSignal(frame: { from?: string; kind: SignalKind }): Promise<void> {
            this.handleRemoteSignalCalls.push(frame);
        }

        resendOffer(): void {
            this.resendOfferCount += 1;
        }

        dispose(): void {
            this.isDisposed = true;
            this.dataChannelReady = false;
        }
    }

    return { peers, MockPeer };
});

type MockChatPeer = (typeof buildPeerMock.peers)[number];

vi.mock("./chat-data-webrtc-peer", () => ({
    ChatDataWebRtcPeer: buildPeerMock.MockPeer,
    buildRtcPeerConnectionConfig: () => ({ iceServers: [] }),
}));

import { fetchActiveChatDataSession, waitForActiveChatDataSession } from "./chat-api";
import * as groupOrchestrator from "./chat-data-group-orchestrator";
import { ChatDataSessionOrchestrator } from "./chat-data-session-orchestrator";

const SELF = "alice";
const PEER = "bob";
const SPACE_DM = "space:dm-alpha";
const SESSION_ID = "wrtc:111";

class FakeRealtimeClient {
    instanceId = "rt-fake-1";

    isSessionReady = true;

    welcomeCount = 1;

    handlers: RealtimeHandlers = {};

    sentClientFrames: unknown[] = [];

    registerHandlers(extra: RealtimeHandlers): void {
        this.handlers = { ...this.handlers, ...extra };
    }

    sendClientFrame(frame: unknown): void {
        this.sentClientFrames.push(frame);
    }

    isReconnectWelcome(): boolean {
        return this.welcomeCount > 1;
    }

    dispatch(frame: ServerRealtimeFrame): void {
        const handler = (this.handlers as Record<string, unknown>)[frame.t];
        if (typeof handler === "function") {
            (handler as (f: ServerRealtimeFrame) => void)(frame);
        }
    }
}

function registerHandlersWithFake(
    rt: FakeRealtimeClient,
): (handlers: RealtimeHandlers) => () => void {
    return (handlers) => {
        rt.registerHandlers(handlers);
        return () => {
            for (const key of Object.keys(handlers) as (keyof RealtimeHandlers)[]) {
                delete (rt.handlers as Record<string, unknown>)[key as string];
            }
        };
    };
}

function makeOrchestrator(
    rt: FakeRealtimeClient,
    presence: Record<string, string> = {},
    callbacks: {
        onSpaceUpdate?: ConstructorParameters<typeof ChatDataSessionOrchestrator>[4];
        onChatMessage?: ConstructorParameters<typeof ChatDataSessionOrchestrator>[5];
        onChatHistorySync?: ConstructorParameters<typeof ChatDataSessionOrchestrator>[6];
        onDataChannelReady?: ConstructorParameters<typeof ChatDataSessionOrchestrator>[7];
        onChatDataSessionInvite?: ConstructorParameters<
            typeof ChatDataSessionOrchestrator
        >[8];
        onFlushPendingRecipients?: ConstructorParameters<
            typeof ChatDataSessionOrchestrator
        >[9];
    } = {},
): ChatDataSessionOrchestrator {
    const orch = new ChatDataSessionOrchestrator(
        () => rt as unknown as RealtimeClient,
        () => SELF,
        () => null,
        () => presence,
        callbacks.onSpaceUpdate,
        callbacks.onChatMessage,
        callbacks.onChatHistorySync,
        callbacks.onDataChannelReady,
        callbacks.onChatDataSessionInvite,
        callbacks.onFlushPendingRecipients,
    );
    orch.start(registerHandlersWithFake(rt));
    return orch;
}

function groupSessionInvite(
    sessionId: string,
    spaceUuid: string,
    participants: string[],
    from: string,
): ServerRealtimeFrame {
    return {
        t: "sessionInvite",
        sessionId,
        appService: "chat",
        appSessionId: spaceUuid,
        purpose: "chat-data",
        from,
        participants,
        transports: [],
        dataChannels: [{ label: "chat", ordered: true }],
        expiresAt: Date.now() + 86_400_000,
        appMetadata: { spaceUuid },
    };
}

/**
 * Plan F7 test helper: the server-authoritative roster frame. Since
 * `syncMeshPeers` now gates per-peer creation on roster membership,
 * unit tests that simulate a sessionInvite must also dispatch a
 * matching snapshot to reach the same state production reaches when
 * the server fans out both frames in the same tick.
 */
function groupSessionSnapshot(
    sessionId: string,
    joined: string[],
    pending: string[] = [],
    epoch = 1,
): ServerRealtimeFrame {
    return {
        t: "sessionSnapshot",
        sessionId,
        epoch,
        joinedParticipants: joined,
        pendingParticipants: pending,
    };
}

async function settleMicrotasks(times = 20): Promise<void> {
    for (let i = 0; i < times; i += 1) {
        await Promise.resolve();
    }
}

function dmSessionSnapshot(
    sessionId: string,
    joined: string[],
    pending: string[] = [],
    epoch = 1,
): ServerRealtimeFrame {
    return {
        t: "sessionSnapshot",
        sessionId,
        epoch,
        joinedParticipants: joined,
        pendingParticipants: pending,
    };
}

async function startDmAndWaitForPeer(
    orch: ChatDataSessionOrchestrator,
    rt?: FakeRealtimeClient,
    options?: { serverJoined?: boolean },
): Promise<ReturnType<typeof getLastPeer>> {
    orch.ensureDmChatDataSession(SPACE_DM, [SELF, PEER]);
    await settleMicrotasks();
    if (rt && options?.serverJoined !== false) {
        rt.dispatch(dmSessionSnapshot(SESSION_ID, [SELF, PEER]));
        await settleMicrotasks();
    }
    const run = orch.getRun(SPACE_DM);
    const peer =
        run?.kind === "dm"
            ? (run.peer as MockChatPeer | null) ?? getLastPeer()
            : getLastPeer();
    expect(peer, "expected mock peer to be created").toBeDefined();
    return peer;
}

function dmLivePeer(orch: ChatDataSessionOrchestrator) {
    const run = orch.getRun(SPACE_DM);
    if (!run || run.kind !== "dm") return undefined;
    return run.peer as MockChatPeer | null;
}

async function confirmDmServerJoined(rt: FakeRealtimeClient): Promise<void> {
    rt.dispatch(dmSessionSnapshot(SESSION_ID, [SELF, PEER]));
    await settleMicrotasks();
}

function getLastPeer() {
    return buildPeerMock.peers.at(-1);
}

beforeEach(() => {
    buildPeerMock.peers.length = 0;
    vi.mocked(fetchActiveChatDataSession).mockResolvedValue(null);
    vi.mocked(waitForActiveChatDataSession).mockResolvedValue({
        session_id: SESSION_ID,
        space_uuid: SPACE_DM,
        purpose: "chat-data",
        lifecycle: 1,
        members: [SELF, PEER],
    } as never);
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe("ChatDataSessionOrchestrator — handler registration", () => {
    it("start() registers realtime handlers before any session is ensured", () => {
        const rt = new FakeRealtimeClient();
        const orch = new ChatDataSessionOrchestrator(
            () => rt as unknown as RealtimeClient,
            () => SELF,
            () => null,
            () => ({}),
        );
        expect(rt.handlers.signal).toBeUndefined();
        orch.start(registerHandlersWithFake(rt));
        expect(rt.handlers.signal).toBeTypeOf("function");
        expect(rt.handlers.sessionInvite).toBeTypeOf("function");
        expect(rt.handlers.participantJoined).toBeTypeOf("function");
    });
});

describe("ChatDataSessionOrchestrator — DM lifecycle", () => {
    it("opens datachannel and reports ready snapshot", async () => {
        const rt = new FakeRealtimeClient();
        const updates: Array<{ phase: string; ready: boolean }> = [];
        const orch = makeOrchestrator(
            rt,
            { [PEER]: "online" },
            {
                onSpaceUpdate: (_space, snap) => {
                    updates.push({
                        phase: snap.phase,
                        ready: snap.dataChannelReady,
                    });
                },
            },
        );

        const peer = await startDmAndWaitForPeer(orch, rt, { serverJoined: true });
        expect(peer!.peerAccount).toBe(PEER);

        peer!.simulateOpen();

        const snap = orch.getSnapshot(SPACE_DM);
        expect(snap.phase).toBe("ready");
        expect(snap.dataChannelReady).toBe(true);
        expect(updates.some((u) => u.phase === "ready" && u.ready)).toBe(true);
    });

    it("re-creates peer and re-fires onDataChannelReady when peer rejoins (regression: pending flush after rejoin)", async () => {
        const rt = new FakeRealtimeClient();
        const dataChannelReadyEvents: Array<{ peerAccount: string }> = [];
        const orch = makeOrchestrator(
            rt,
            { [PEER]: "online" },
            {
                onDataChannelReady: (_space, info) =>
                    dataChannelReadyEvents.push({
                        peerAccount: info.peerAccount,
                    }),
            },
        );

        const firstPeer = (await startDmAndWaitForPeer(orch, rt, { serverJoined: true }))!;
        firstPeer.simulateOpen();
        expect(orch.getSnapshot(SPACE_DM).dataChannelReady).toBe(true);
        expect(dataChannelReadyEvents).toHaveLength(1);

        rt.dispatch({
            t: "participantJoined",
            sessionId: SESSION_ID,
            participant: PEER,
        });
        await settleMicrotasks();

        expect(firstPeer.isDisposed).toBe(true);
        expect(buildPeerMock.peers.length).toBeGreaterThanOrEqual(2);

        const secondPeer = getLastPeer()!;
        expect(secondPeer).not.toBe(firstPeer);
        expect(secondPeer.isDisposed).toBe(false);
        expect(orch.getSnapshot(SPACE_DM).dataChannelReady).toBe(false);

        secondPeer.simulateOpen();
        expect(orch.getSnapshot(SPACE_DM).dataChannelReady).toBe(true);
        expect(dataChannelReadyEvents).toHaveLength(2);
        expect(dataChannelReadyEvents[1]).toMatchObject({ peerAccount: PEER });
    });

    it("flips snapshot.dataChannelReady to false when transport is lost", async () => {
        const rt = new FakeRealtimeClient();
        const orch = makeOrchestrator(rt, { [PEER]: "online" });

        const peer = (await startDmAndWaitForPeer(orch, rt, { serverJoined: true }))!;
        peer.simulateOpen();
        expect(orch.getSnapshot(SPACE_DM).dataChannelReady).toBe(true);

        peer.simulateTransportLost();
        expect(orch.getSnapshot(SPACE_DM).dataChannelReady).toBe(false);
    });

    it("does not double-create peer when participantJoined fires while signaling is in flight", async () => {
        const rt = new FakeRealtimeClient();
        const orch = makeOrchestrator(rt, { [PEER]: "online" });

        const firstPeer = (await startDmAndWaitForPeer(orch, rt, {
            serverJoined: true,
        }))!;
        expect(firstPeer.isDisposed).toBe(false);
        const phaseBefore = orch.getSnapshot(SPACE_DM).phase;

        rt.dispatch({
            t: "participantJoined",
            sessionId: SESSION_ID,
            participant: PEER,
        });
        await settleMicrotasks();

        const livePeer = dmLivePeer(orch) ?? firstPeer;
        expect(livePeer?.isDisposed).toBe(false);
        expect(orch.getSnapshot(SPACE_DM).phase).toBe(phaseBefore);
        expect(livePeer?.resendOfferCount).toBeGreaterThanOrEqual(1);
    });

    it("participantJoined resends offer when initiator while signaling is in flight", async () => {
        const rt = new FakeRealtimeClient();
        const orch = makeOrchestrator(rt, { [PEER]: "online" });

        const peer = (await startDmAndWaitForPeer(orch, rt, {
            serverJoined: true,
        }))!;
        expect(peer!.isInitiator).toBe(true);
        expect(orch.getSnapshot(SPACE_DM).dataChannelReady).toBe(false);

        rt.dispatch({
            t: "participantJoined",
            sessionId: SESSION_ID,
            participant: PEER,
        });
        await settleMicrotasks();

        const livePeer = dmLivePeer(orch) ?? peer;
        expect(livePeer?.resendOfferCount).toBeGreaterThanOrEqual(1);
    });

    /**
     * Regression: initiator sends offer before the remote joins the
     * signaling session (or after the remote reloads). The initiator stays
     * in `have-local-offer`; production `resendOffer` must retransmit the
     * existing local SDP (not skip) so the late joiner can answer.
     */
    it("DM late joiner can complete after initiator retransmits offer", async () => {
        const rt = new FakeRealtimeClient();
        const orch = makeOrchestrator(rt, { [PEER]: "online" });

        const initiatorPeer = (await startDmAndWaitForPeer(orch, rt, { serverJoined: true }))!;
        expect(initiatorPeer.isInitiator).toBe(true);
        expect(orch.getSnapshot(SPACE_DM).dataChannelReady).toBe(false);

        rt.dispatch({
            t: "participantJoined",
            sessionId: SESSION_ID,
            participant: PEER,
        });
        await settleMicrotasks();
        expect(initiatorPeer.resendOfferCount).toBeGreaterThanOrEqual(1);

        initiatorPeer.simulateOpen();
        expect(orch.getSnapshot(SPACE_DM).dataChannelReady).toBe(true);
    });

    it("onPeerOnline resends offer when initiator while signaling is in flight", async () => {
        const rt = new FakeRealtimeClient();
        const orch = makeOrchestrator(rt, { [PEER]: "online" });

        const peer = (await startDmAndWaitForPeer(orch, rt, {
            serverJoined: true,
        }))!;
        expect(peer!.isInitiator).toBe(true);
        expect(orch.getSnapshot(SPACE_DM).dataChannelReady).toBe(false);

        orch.onPeerOnline(PEER);

        const livePeer = dmLivePeer(orch) ?? peer;
        expect(livePeer?.resendOfferCount).toBeGreaterThanOrEqual(1);
        expect(livePeer?.isDisposed).toBe(false);
    });

    it("rebuilds peer when same peer comes online after disconnect", async () => {
        const rt = new FakeRealtimeClient();
        const presence: Record<string, string> = { [PEER]: "online" };
        const orch = makeOrchestrator(rt, presence);

        const firstPeer = (await startDmAndWaitForPeer(orch, rt, { serverJoined: true }))!;
        firstPeer.simulateOpen();
        firstPeer.simulateTransportLost("peer disconnected");
        expect(firstPeer.isDisposed).toBe(true);
        expect(orch.getSnapshot(SPACE_DM).dataChannelReady).toBe(false);

        presence[PEER] = "online";
        orch.onPeerOnline(PEER);
        await settleMicrotasks();

        const newPeer = getLastPeer()!;
        expect(newPeer).not.toBe(firstPeer);
        expect(newPeer.isDisposed).toBe(false);
        newPeer.simulateOpen();
        expect(orch.getSnapshot(SPACE_DM).dataChannelReady).toBe(true);
    });

    it("onPeerOffline tears down stale DM transport", async () => {
        const rt = new FakeRealtimeClient();
        const presence: Record<string, string> = { [PEER]: "online" };
        const orch = makeOrchestrator(rt, presence);

        const peer = (await startDmAndWaitForPeer(orch, rt, { serverJoined: true }))!;
        peer.simulateOpen();
        expect(orch.getSnapshot(SPACE_DM).dataChannelReady).toBe(true);

        presence[PEER] = "offline";
        orch.onPeerOffline(PEER);
        expect(orch.getSnapshot(SPACE_DM).dataChannelReady).toBe(false);
        expect(orch.getSnapshot(SPACE_DM).phase).toBe("waiting-peer");
    });

    it("onPeerOnline resumes when snapshot.dataChannelReady is stale but peer is dead", async () => {
        const rt = new FakeRealtimeClient();
        const presence: Record<string, string> = { [PEER]: "online" };
        const dataChannelReadyEvents: Array<{ peerAccount: string }> = [];
        const orch = makeOrchestrator(
            rt,
            presence,
            {
                onDataChannelReady: (_space, info) =>
                    dataChannelReadyEvents.push({
                        peerAccount: info.peerAccount,
                    }),
            },
        );

        const firstPeer = (await startDmAndWaitForPeer(orch, rt, { serverJoined: true }))!;
        firstPeer.simulateOpen();
        expect(dataChannelReadyEvents).toHaveLength(1);

        // Stale run.snapshot.dataChannelReady while the peer transport is dead.
        firstPeer.dataChannelReady = false;
        expect(orch.getSnapshot(SPACE_DM).dataChannelReady).toBe(false);

        orch.onPeerOnline(PEER);
        await settleMicrotasks();

        getLastPeer()!.simulateOpen();
        expect(orch.getSnapshot(SPACE_DM).dataChannelReady).toBe(true);
        expect(dataChannelReadyEvents).toHaveLength(2);
    });

    it("sendChatMessage routes to the live mesh-aware peer and returns false when not ready", async () => {
        const rt = new FakeRealtimeClient();
        const orch = makeOrchestrator(rt, { [PEER]: "online" });

        const peer = (await startDmAndWaitForPeer(orch, rt, { serverJoined: true }))!;
        const envelope: ChatDataMessageEnvelope = {
            t: "chatMessage",
            spaceUuid: SPACE_DM,
            from: SELF,
            body: "hi",
            sendTimestamp: 1,
            clientMsgId: "m1",
        };
        expect(orch.sendChatMessage(SPACE_DM, envelope)).toBe(false);

        peer.simulateOpen();
        expect(orch.sendChatMessage(SPACE_DM, envelope)).toBe(true);
        expect(peer.sentMessages).toContainEqual(envelope);
    });
});

/**
 * Phase D: end-to-end outbox drain across a DM rejoin cycle.
 *
 * The bug we're guarding against: when the peer leaves and rejoins, the
 * orchestrator must not just rebuild the WebRTC peer — it must also tell
 * the host's outbox to retry messages bound for that specific recipient.
 *
 * The wiring runs through the FSM:
 *   peerOpened → `flushPending { recipients: [<peer>] }` command
 *               → host.onFlushPendingRecipients(spaceUuid, recipients)
 *               → flushPendingMessages({ forceRecipients }) in the React hook
 *
 * If any link in that chain is broken, queued sends silently wedge. These
 * tests assert each call into the host so the regression surfaces in unit
 * tests rather than a live chain.
 */
describe("ChatDataSessionOrchestrator — outbox drain (Phase D)", () => {
    it("emits onFlushPendingRecipients targeted at the rejoined peer", async () => {
        const rt = new FakeRealtimeClient();
        const flushCalls: Array<{ space: string; recipients: string[] }> = [];
        const orch = makeOrchestrator(
            rt,
            { [PEER]: "online" },
            {
                onFlushPendingRecipients: (space, recipients) =>
                    flushCalls.push({
                        space,
                        recipients: [...recipients],
                    }),
            },
        );

        const firstPeer = (await startDmAndWaitForPeer(orch, rt, { serverJoined: true }))!;
        firstPeer.simulateOpen();
        // First open → first targeted flush for PEER.
        expect(flushCalls).toEqual([
            { space: SPACE_DM, recipients: [PEER] },
        ]);

        // Peer rejoins (server fans out participantJoined; FSM disposes the
        // stale peer and starts a new negotiation).
        rt.dispatch({
            t: "participantJoined",
            sessionId: SESSION_ID,
            participant: PEER,
        });
        await settleMicrotasks();
        expect(firstPeer.isDisposed).toBe(true);

        const secondPeer = getLastPeer()!;
        expect(secondPeer).not.toBe(firstPeer);
        secondPeer.simulateOpen();

        // The second DC open must produce a second targeted flush so any
        // messages typed while the peer was gone go out — and they must
        // be scoped to [PEER], not blanket-flushing the whole outbox.
        expect(flushCalls).toEqual([
            { space: SPACE_DM, recipients: [PEER] },
            { space: SPACE_DM, recipients: [PEER] },
        ]);
    });

    it("recovers from `failed` (sessionEnded by peer) and still drains the outbox on reopen", async () => {
        const rt = new FakeRealtimeClient();
        const flushCalls: Array<{ recipients: string[] }> = [];
        const orch = makeOrchestrator(
            rt,
            { [PEER]: "online" },
            {
                onFlushPendingRecipients: (_space, recipients) =>
                    flushCalls.push({ recipients: [...recipients] }),
            },
        );

        const firstPeer = (await startDmAndWaitForPeer(orch, rt, { serverJoined: true }))!;
        firstPeer.simulateOpen();
        expect(flushCalls).toHaveLength(1);

        // Peer's tab disposed → server fans out sessionEnded by=peer →
        // FSM transitions to `failed` and disposes all peers.
        rt.dispatch({
            t: "sessionEnded",
            sessionId: SESSION_ID,
            reason: "client-disposed",
            by: PEER,
        });
        await settleMicrotasks();
        expect(firstPeer.isDisposed).toBe(true);
        expect(orch.getSnapshot(SPACE_DM).phase).toBe("failed");

        // No flushes while in `failed`.
        expect(flushCalls).toHaveLength(1);

        // Peer comes back: server broadcasts sessionInvite for the same
        // session id. FSM recovers from failed → signaling → new peer.
        rt.dispatch({
            t: "sessionInvite",
            sessionId: SESSION_ID,
            appService: "chat",
            appSessionId: SPACE_DM,
            purpose: "chat-data",
            from: PEER,
            participants: [SELF, PEER],
            transports: [],
            dataChannels: [{ label: "chat", ordered: true }],
            expiresAt: Date.now() + 86_400_000,
            appMetadata: { spaceUuid: SPACE_DM },
        });
        await settleMicrotasks();

        const secondPeer = getLastPeer()!;
        expect(secondPeer).not.toBe(firstPeer);
        secondPeer.simulateOpen();

        // Recovery flush is targeted at the recipient that just came
        // back, NOT blanket. This is the user-visible "stuck Pending"
        // fix for the send-after-rejoin scenario.
        expect(flushCalls).toEqual([
            { recipients: [PEER] },
            { recipients: [PEER] },
        ]);
    });
});

describe("ChatDataSessionOrchestrator — group/DM session isolation", () => {
    const CAROL = "carol";
    const SPACE_GROUP = "space:group-alpha";
    const SESSION_GROUP = "wrtc:group-111";
    const SESSION_DM = "wrtc:dm-222";

    function groupMeshPeer(
        orch: ChatDataSessionOrchestrator,
        remoteAccount: string,
    ): MockChatPeer | undefined {
        const run = orch.getRun(SPACE_GROUP);
        if (!run || run.kind !== "group") return undefined;
        return run.meshPeers.get(remoteAccount) as MockChatPeer | undefined;
    }

    it("participantJoined for a DM session does not rebind an in-flight group run", async () => {
        const rt = new FakeRealtimeClient();
        const orch = makeOrchestrator(rt, {
            [PEER]: "online",
            [CAROL]: "online",
        });

        rt.dispatch(
            groupSessionInvite(
                SESSION_GROUP,
                SPACE_GROUP,
                [SELF, PEER, CAROL],
                PEER,
            ),
        );
        await settleMicrotasks();

        expect(orch.getSnapshot(SPACE_GROUP).sessionId).toBe(SESSION_GROUP);

        rt.dispatch({
            t: "participantJoined",
            sessionId: SESSION_DM,
            participant: PEER,
        });
        await settleMicrotasks();

        expect(orch.getSnapshot(SPACE_GROUP).sessionId).toBe(SESSION_GROUP);
    });

    /**
     * Regression: in production logs (myprod + alicealice + daviddavid), as
     * soon as alicealice's first tab disposed, the server broadcast
     * `sessionEnded { by: alicealice, reason: client-disposed }`. The state
     * machine treated this as fatal, disposing every mesh peer including
     * daviddavid's. Subsequent sends to daviddavid then logged
     * `flush pending: group mesh peer not ready`. After the fix only
     * alicealice's mesh peer is torn down; daviddavid's peer remains open
     * and ready.
     */
    it("group sessionEnded by another participant only disposes the leaver's mesh peer", async () => {
        const rt = new FakeRealtimeClient();
        const orch = makeOrchestrator(rt, {
            [PEER]: "online",
            [CAROL]: "online",
        });

        rt.dispatch(
            groupSessionInvite(
                SESSION_GROUP,
                SPACE_GROUP,
                [SELF, PEER, CAROL],
                PEER,
            ),
        );
        // F7: server's authoritative roster snapshot — needed so
        // `syncMeshPeers` creates mesh peers for both remotes.
        rt.dispatch(
            groupSessionSnapshot(SESSION_GROUP, [SELF, PEER, CAROL]),
        );
        await settleMicrotasks();
        orch.ensureGroupChatDataSession(SPACE_GROUP, [SELF, PEER, CAROL]);
        await settleMicrotasks();

        // After the invite, group mesh peers exist for both remotes.
        const peerForBob = groupMeshPeer(orch, PEER);
        const peerForCarol = groupMeshPeer(orch, CAROL);
        expect(peerForBob).toBeDefined();
        expect(peerForCarol).toBeDefined();
        peerForBob!.simulateOpen();
        peerForCarol!.simulateOpen();
        await settleMicrotasks();
        expect(orch.getSnapshot(SPACE_GROUP).phase).toBe("ready");

        // Bob disposes their tab → server broadcasts sessionEnded by bob.
        rt.dispatch({
            t: "sessionEnded",
            sessionId: SESSION_GROUP,
            by: PEER,
            reason: "client-disposed",
        });
        await settleMicrotasks();

        // The leaver's peer is disposed; carol's peer must stay alive.
        expect(peerForBob!.isDisposed).toBe(true);
        expect(peerForCarol!.isDisposed).toBe(false);
        expect(peerForCarol!.dataChannelReady).toBe(true);

        // The run must NOT be in `failed` — it should still be usable.
        expect(orch.getSnapshot(SPACE_GROUP).phase).not.toBe("failed");
        // Carol's mesh-peer reachability stays true so message planner can
        // still flush to her.
        expect(orch.groupMeshPeerReady(SPACE_GROUP, CAROL)).toBe(true);
    });

    /**
     * H25: pending flush calls `ensureChatDataSession` while the group run is
     * already in `signaling` but not all online mesh legs are ready. The entry
     * point must still nudge `beginSignalingGroup`, not return early.
     */
    it("ensureChatDataSession nudges incomplete group mesh while signaling", async () => {
        const rt = new FakeRealtimeClient();
        const orch = makeOrchestrator(rt, {
            [PEER]: "online",
            [CAROL]: "online",
        });
        const beginSpy = vi.spyOn(groupOrchestrator, "beginSignalingGroup");

        rt.dispatch(
            groupSessionInvite(
                SESSION_GROUP,
                SPACE_GROUP,
                [SELF, PEER, CAROL],
                PEER,
            ),
        );
        rt.dispatch(
            groupSessionSnapshot(SESSION_GROUP, [SELF, PEER, CAROL]),
        );
        await settleMicrotasks();

        const peerForBob = groupMeshPeer(orch, PEER);
        const peerForCarol = groupMeshPeer(orch, CAROL);
        expect(peerForBob).toBeDefined();
        expect(peerForCarol).toBeDefined();
        peerForBob!.simulateOpen();
        expect(orch.getSnapshot(SPACE_GROUP).phase).toBe("signaling");
        expect(orch.groupMeshPeerReady(SPACE_GROUP, CAROL)).toBe(false);

        beginSpy.mockClear();
        orch.ensureChatDataSession(SPACE_GROUP, [SELF, PEER, CAROL]);
        expect(beginSpy).toHaveBeenCalled();
        beginSpy.mockRestore();
    });

    /**
     * Phase D: group analog of the DM outbox-drain test. When bob's tab
     * rebroadcasts the sessionInvite after rejoining, alice's FSM must
     * recreate the mesh peer for bob and emit a targeted `flushPending`
     * for only bob (NOT for carol who never went offline).
     */
    it("group rejoin produces a targeted outbox flush for only the rejoined peer", async () => {
        const rt = new FakeRealtimeClient();
        const flushCalls: Array<{ recipients: string[] }> = [];
        const orch = makeOrchestrator(
            rt,
            { [PEER]: "online", [CAROL]: "online" },
            {
                onFlushPendingRecipients: (_space, recipients) =>
                    flushCalls.push({ recipients: [...recipients] }),
            },
        );

        rt.dispatch(
            groupSessionInvite(
                SESSION_GROUP,
                SPACE_GROUP,
                [SELF, PEER, CAROL],
                PEER,
            ),
        );
        rt.dispatch(
            groupSessionSnapshot(SESSION_GROUP, [SELF, PEER, CAROL]),
        );
        await settleMicrotasks();
        orch.ensureGroupChatDataSession(SPACE_GROUP, [SELF, PEER, CAROL]);
        await settleMicrotasks();

        const peerForBob = groupMeshPeer(orch, PEER)!;
        const peerForCarol = groupMeshPeer(orch, CAROL)!;
        peerForBob.simulateOpen();
        peerForCarol.simulateOpen();
        await settleMicrotasks();
        // Initial opens emitted one flush per recipient.
        expect(flushCalls.map((c) => c.recipients).flat().sort()).toEqual(
            [CAROL, PEER].sort(),
        );

        const initialFlushCount = flushCalls.length;

        // Bob disposes and rejoins. Server fans out sessionEnded(by=bob),
        // then a fresh sessionInvite from bob, then participantJoined.
        rt.dispatch({
            t: "sessionEnded",
            sessionId: SESSION_GROUP,
            by: PEER,
            reason: "client-disposed",
        });
        await settleMicrotasks();
        expect(peerForBob.isDisposed).toBe(true);
        expect(peerForCarol.isDisposed).toBe(false);

        rt.dispatch({
            t: "participantJoined",
            sessionId: SESSION_GROUP,
            participant: PEER,
        });
        await settleMicrotasks();

        const peerForBob2 = groupMeshPeer(orch, PEER)!;
        expect(peerForBob2).not.toBe(peerForBob);
        peerForBob2.simulateOpen();
        await settleMicrotasks();

        // The flush emitted by bob's rebuild MUST be targeted at bob
        // alone — carol is still connected and her outbox shouldn't be
        // re-drained on every group rejoin event.
        const newFlushes = flushCalls.slice(initialFlushCount);
        expect(newFlushes).toContainEqual({ recipients: [PEER] });
        expect(newFlushes.every((f) => f.recipients.includes(PEER))).toBe(true);
        expect(newFlushes.some((f) => f.recipients.includes(CAROL))).toBe(false);
    });

    it("group sessionEnded with by=self still fails the run", async () => {
        const rt = new FakeRealtimeClient();
        const orch = makeOrchestrator(rt, {
            [PEER]: "online",
            [CAROL]: "online",
        });

        rt.dispatch(
            groupSessionInvite(
                SESSION_GROUP,
                SPACE_GROUP,
                [SELF, PEER, CAROL],
                PEER,
            ),
        );
        await settleMicrotasks();

        rt.dispatch({
            t: "sessionEnded",
            sessionId: SESSION_GROUP,
            by: SELF,
            reason: "client-disposed",
        });
        await settleMicrotasks();

        expect(orch.getSnapshot(SPACE_GROUP).phase).toBe("failed");
    });

    it("fires onChatDataSessionInvite when a chat-data sessionInvite arrives", async () => {
        const rt = new FakeRealtimeClient();
        const invites: string[] = [];
        const orch = makeOrchestrator(rt, { [PEER]: "online", [CAROL]: "online" }, {
            onChatDataSessionInvite: (spaceUuid) => invites.push(spaceUuid),
        });

        rt.dispatch(
            groupSessionInvite(
                SESSION_GROUP,
                SPACE_GROUP,
                [SELF, PEER, CAROL],
                PEER,
            ),
        );
        await settleMicrotasks();

        expect(invites).toEqual([SPACE_GROUP]);
        expect(orch.getSnapshot(SPACE_GROUP).phase).toBe("signaling");
        expect(
            rt.sentClientFrames.some(
                (frame) =>
                    typeof frame === "object" &&
                    frame !== null &&
                    (frame as { t?: string }).t === "joinSession" &&
                    (frame as { sessionId?: string }).sessionId ===
                        SESSION_GROUP,
            ),
        ).toBe(true);
    });

    it("group re-sends joinSession when server snapshot shows self pending", async () => {
        const rt = new FakeRealtimeClient();
        const orch = makeOrchestrator(rt, {
            [PEER]: "online",
            [CAROL]: "online",
        });

        rt.dispatch(
            groupSessionInvite(
                SESSION_GROUP,
                SPACE_GROUP,
                [SELF, PEER, CAROL],
                PEER,
            ),
        );
        rt.dispatch(
            groupSessionSnapshot(SESSION_GROUP, [SELF, PEER, CAROL]),
        );
        await settleMicrotasks();

        const joinCountBefore = rt.sentClientFrames.filter(
            (frame) =>
                typeof frame === "object" &&
                frame !== null &&
                (frame as { t?: string }).t === "joinSession",
        ).length;
        expect(joinCountBefore).toBeGreaterThan(0);

        const run = (
            orch as unknown as {
                runs: Map<
                    string,
                    { hasJoined: boolean; joinSessionRequested: boolean }
                >;
            }
        ).runs.get(SPACE_GROUP);
        expect(run?.hasJoined).toBe(true);

        // Server lost our join row (websocket died) but we never got a local
        // transportTornDown — the stale hasJoined flag must not block re-join.
        rt.dispatch(
            groupSessionSnapshot(
                SESSION_GROUP,
                [PEER, CAROL],
                [SELF],
                2,
            ),
        );
        await settleMicrotasks();

        const joinCountAfter = rt.sentClientFrames.filter(
            (frame) =>
                typeof frame === "object" &&
                frame !== null &&
                (frame as { t?: string }).t === "joinSession" &&
                (frame as { sessionId?: string }).sessionId === SESSION_GROUP,
        ).length;
        expect(joinCountAfter).toBeGreaterThan(joinCountBefore);
        expect(run?.hasJoined).toBe(false);
        expect(run?.joinSessionRequested).toBe(true);
    });

    /**
     * Phase C invariant: each mesh connection has an independent
     * lifecycle. If bob's PC reports `onFailed` (ICE failed, transport
     * dead), the FSM should drop bob's connection but leave carol's
     * peer/data channel alive. carol must remain reachable for sends.
     */
    it("group: one connection's onFailed does not poison the rest of the mesh", async () => {
        const rt = new FakeRealtimeClient();
        const orch = makeOrchestrator(rt, {
            [PEER]: "online",
            [CAROL]: "online",
        });

        rt.dispatch(
            groupSessionInvite(
                SESSION_GROUP,
                SPACE_GROUP,
                [SELF, PEER, CAROL],
                PEER,
            ),
        );
        rt.dispatch(
            groupSessionSnapshot(SESSION_GROUP, [SELF, PEER, CAROL]),
        );
        await settleMicrotasks();
        orch.ensureGroupChatDataSession(SPACE_GROUP, [SELF, PEER, CAROL]);
        await settleMicrotasks();

        const peerForBob = groupMeshPeer(orch, PEER)!;
        const peerForCarol = groupMeshPeer(orch, CAROL)!;
        peerForBob.simulateOpen();
        peerForCarol.simulateOpen();
        await settleMicrotasks();
        expect(orch.getSnapshot(SPACE_GROUP).phase).toBe("ready");

        // Bob's connection blows up at the WebRTC layer.
        peerForBob.simulateFailed("ice failed");
        await settleMicrotasks();

        // Carol's connection must NOT be affected.
        expect(peerForCarol.isDisposed).toBe(false);
        expect(peerForCarol.dataChannelReady).toBe(true);
        expect(orch.groupMeshPeerReady(SPACE_GROUP, CAROL)).toBe(true);
        // The run itself must NOT be in `failed` (that would dispose
        // the rest of the mesh).
        expect(orch.getSnapshot(SPACE_GROUP).phase).not.toBe("failed");
    });

    it("suspendForNavigation blocks ensureChatDataSession until resume", () => {
        const rt = new FakeRealtimeClient();
        const orch = makeOrchestrator(rt, { [PEER]: "online" });
        orch.ensureChatDataSession(SPACE_DM, [SELF, PEER]);
        expect(orch.getRun(SPACE_DM)).toBeDefined();
        orch.suspendForNavigation();
        expect(orch.isNavigationSuspended()).toBe(true);
        expect(orch.getRun(SPACE_DM)).toBeUndefined();
        orch.ensureChatDataSession(SPACE_DM, [SELF, PEER]);
        expect(orch.getRun(SPACE_DM)).toBeUndefined();
        orch.resumeAfterNavigation();
        orch.ensureChatDataSession(SPACE_DM, [SELF, PEER]);
        expect(orch.getRun(SPACE_DM)).toBeDefined();
    });

    it("suspendForNavigation leaveSessions when sessionId exists but hasJoined is false", async () => {
        const rt = new FakeRealtimeClient();
        const orch = makeOrchestrator(rt, { [PEER]: "online" });
        orch.ensureChatDataSession(SPACE_GROUP, [SELF, PEER, CAROL]);
        const run = orch.getRun(SPACE_GROUP);
        expect(run?.kind).toBe("group");
        if (!run || run.kind !== "group") return;
        run.hasJoined = false;
        run.snapshot.sessionId = "wrtc:test-session";
        orch.suspendForNavigation();
        await new Promise<void>((resolve) => queueMicrotask(resolve));
        const leaves = rt.sentClientFrames.filter(
            (f) => (f as { t?: string }).t === "leaveSession",
        );
        expect(leaves.length).toBeGreaterThan(0);
        expect(
            (leaves[0] as { sessionId?: string; reason?: string }).sessionId,
        ).toBe("wrtc:test-session");
        expect(
            (leaves[0] as { sessionId?: string; reason?: string }).reason,
        ).toBe("navigation-suspend");
    });
});
