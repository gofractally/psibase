import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    serializeChatDataMessage,
    type ChatDataMessageEnvelope,
} from "../lib/chat-data-envelope";
import type { ChatDataPeerHandlers } from "../lib/chat-data-webrtc-peer";
import {
    createTwoPartyHub,
    createTwoPartyStacks,
    createThreePartyStacks,
    createStackFixture,
    establishPair,
    FakeRealtimeClient,
    pairIdFor,
} from "./stack-test-harness";
import { createChatTransportStack } from "./stack";
import { IN_FLIGHT_ACK_WAIT_MS, MAX_VALID_ATTEMPTS } from "./types";

vi.mock("../lib/chat-data-debug", () => ({
    chatDataRecord: () => {},
    chatDataLog: () => {},
    logIceCandidate: () => {},
    registerChatDataPeer: () => {},
    unregisterChatDataPeer: () => {},
    summarizePeerConnection: async () => ({}),
    shortSessionId: (id: string) => id,
    shortSpaceId: (id: string) => id,
    iceServerSummary: () => "none",
    installChatDataDebugGlobal: () => {},
}));

const peerMock = vi.hoisted(() => {
    const mockPeers: MockChatDataWebRtcPeer[] = [];

    class MockChatDataWebRtcPeer {
        readonly sessionId: string;

        readonly selfAccount: string;

        readonly peerAccount: string;

        readonly isInitiator: boolean;

        dataChannelReady = false;

        private disposed = false;

        private readonly handlers: ChatDataPeerHandlers;

        private readonly pendingOutbound: ChatDataMessageEnvelope[] = [];

        resendOfferCalls = 0;

        constructor(params: {
            sessionId: string;
            selfAccount: string;
            peerAccount: string;
            iceServers: unknown;
            signaling: unknown;
            isInitiator: boolean;
            impolite?: boolean;
            handlers?: ChatDataPeerHandlers;
        }) {
            this.sessionId = params.sessionId;
            this.selfAccount = params.selfAccount;
            this.peerAccount = params.peerAccount;
            this.isInitiator = params.isInitiator;
            this.handlers = params.handlers ?? {};
            mockPeers.push(this);
            queueMicrotask(() => {
                if (this.disposed) return;
                this.dataChannelReady = true;
                this.handlers.onDataChannelOpen?.();
            });
        }

        get isDisposed(): boolean {
            return this.disposed;
        }

        sendChatMessage(envelope: ChatDataMessageEnvelope): boolean {
            if (!this.dataChannelReady) return false;
            this.pendingOutbound.push(envelope);
            return true;
        }

        sendHistorySync(): boolean {
            return this.dataChannelReady;
        }

        sendMessageAck(): boolean {
            return this.dataChannelReady;
        }

        get sendsInitialOffer(): boolean {
            return this.isInitiator;
        }

        resendOffer(): void {
            this.resendOfferCalls += 1;
        }

        restartIce(): void {}

        stopMeetMedia(): void {}

        dispose(): void {
            this.disposed = true;
            this.dataChannelReady = false;
        }

        async handleRemoteSignal(): Promise<void> {}

        drainPendingOutbound(): ChatDataMessageEnvelope[] {
            return this.pendingOutbound.splice(0);
        }
    }

    return { mockPeers, MockChatDataWebRtcPeer };
});

vi.mock("../lib/chat-data-webrtc-peer", () => ({
    ChatDataWebRtcPeer: peerMock.MockChatDataWebRtcPeer,
}));

const { mockPeers } = peerMock;

describe("createChatTransportStack integration", () => {
    beforeEach(() => {
        mockPeers.length = 0;
        localStorage.clear();
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("joinPair sends joinSession and sessionSnapshot creates usable peer", async () => {
        const hub = createTwoPartyHub();
        const { alice, bob } = createTwoPartyStacks(hub);

        const pairId = pairIdFor("alice", "bob");
        expect(alice.stack.peerRegistry.getState("bob")).toBe("absent");

        hub.setPresence("bob", true);
        await establishPair(hub, alice, bob);

        expect(
            alice.rt.sentFrames.some(
                (f) => f.t === "joinSession" && f.sessionId === pairId,
            ),
        ).toBe(true);
        expect(hub.joinCount(pairId)).toBe(2);
        expect(alice.stack.peerRegistry.getState("bob")).toBe("usable");
    });

    it("sessionSnapshot for both participants establishes pair on each side", async () => {
        const hub = createTwoPartyHub();
        const { alice, bob } = createTwoPartyStacks(hub);

        await establishPair(hub, alice, bob);

        expect(alice.stack.peerRegistry.getState("bob")).toBe("usable");
        expect(bob.stack.peerRegistry.getState("alice")).toBe("usable");
        expect(hub.joinCount(pairIdFor("alice", "bob"))).toBe(2);
    });

    it("messaging.send delivers over usable peer after pair join", async () => {
        const hub = createTwoPartyHub();
        const { alice, bob } = createTwoPartyStacks(hub);
        await establishPair(hub, alice, bob);

        hub.setPresence("bob", true);
        const { msgId } = await alice.stack.messaging.send({
            spaceUuid: "space:dm",
            recipient: "bob",
            body: "hello stack",
        });
        await Promise.resolve();

        expect(alice.stack.messaging.getStatus(msgId)).toBe("PENDING");
        const alicePeer = mockPeers.find(
            (p) => p.selfAccount === "alice" && p.peerAccount === "bob",
        );
        expect(alicePeer?.drainPendingOutbound()).toEqual([
            expect.objectContaining({
                t: "chatMessage",
                body: "hello stack",
                clientMsgId: msgId,
            }),
        ]);
        void bob;
    });

    it("routes inbound bytes from peer registry to messaging ACK handler", async () => {
        const hub = createTwoPartyHub();
        const { alice, bob } = createTwoPartyStacks(hub);
        await establishPair(hub, alice, bob);
        hub.setPresence("bob", true);

        const { msgId } = await alice.stack.messaging.send({
            spaceUuid: "space:dm",
            recipient: "bob",
            body: "ack me",
        });
        await Promise.resolve();

        const svc = alice.stack.messaging as typeof alice.stack.messaging & {
            handleWireFromRemote: (remote: string, raw: string) => void;
        };
        svc.handleWireFromRemote(
            "bob",
            JSON.stringify({
                t: "messageAck",
                spaceUuid: "space:dm",
                clientMsgId: msgId,
                from: "bob",
            }),
        );

        expect(alice.stack.messaging.getStatus(msgId)).toBe("DELIVERED");
    });

    it("defers outbound signal until sessionSnapshot confirms join", async () => {
        const hub = createTwoPartyHub();
        const rt = new FakeRealtimeClient("alice");
        hub.register("alice", rt);
        const stack = createChatTransportStack({
            localAccount: "alice",
            chainId: "test",
            realtimeClient: rt,
            iceServers: null,
        });
        stack.wireRealtimeHandlers({});
        rt.connect();

        const pairId = pairIdFor("alice", "bob");
        stack.signaling.signal({
            sessionId: pairId,
            to: "bob",
            kind: "offer",
            sdp: "v=0 deferred-offer",
        });
        expect(rt.sentFrames.filter((f) => f.t === "signal")).toHaveLength(0);

        stack.signaling.joinSession(pairId);

        expect(
            rt.sentFrames.some(
                (f) =>
                    f.t === "signal" &&
                    f.kind === "offer" &&
                    f.sdp === "v=0 deferred-offer",
            ),
        ).toBe(true);
    });

    it("ignores stale sessionSnapshot epoch on pair roster", async () => {
        const hub = createTwoPartyHub();
        const { alice, bob } = createTwoPartyStacks(hub);
        hub.setPresence("carol", true);
        await establishPair(hub, alice, bob);
        void alice.stack.peerRegistry.ensure("carol", "peer_focus");
        await Promise.resolve();

        const carolPairId = pairIdFor("alice", "carol");

        alice.rt.dispatch({
            t: "sessionSnapshot",
            sessionId: carolPairId,
            joinedParticipants: ["alice", "carol"],
            pendingParticipants: [],
            epoch: 2,
        });
        expect(alice.stack.pairSignaling.isJoined(carolPairId)).toBe(true);

        alice.rt.dispatch({
            t: "sessionSnapshot",
            sessionId: carolPairId,
            joinedParticipants: ["carol"],
            pendingParticipants: ["alice"],
            epoch: 1,
        });
        expect(alice.stack.pairSignaling.isJoined(carolPairId)).toBe(true);

        const signalFramesBefore = alice.rt.sentFrames.filter(
            (f) => f.t === "signal",
        ).length;
        alice.stack.pairSignaling.signal(carolPairId, {
            sessionId: carolPairId,
            to: "carol",
            kind: "offer",
            sdp: "v=0 post-stale-offer",
        });
        expect(
            alice.rt.sentFrames.filter((f) => f.t === "signal").length,
        ).toBeGreaterThan(signalFramesBefore);
    });

    it("re-joins pair sessions after welcome reconnect", async () => {
        const hub = createTwoPartyHub();
        const { alice, bob } = createTwoPartyStacks(hub);
        await establishPair(hub, alice, bob);
        expect(alice.stack.peerRegistry.getState("bob")).toBe("usable");

        const pairId = pairIdFor("alice", "bob");
        const countPairJoins = (rt: FakeRealtimeClient) =>
            rt.sentFrames.filter(
                (f) => f.t === "joinSession" && f.sessionId === pairId,
            ).length;
        const joinsBefore = countPairJoins(alice.rt);
        expect(joinsBefore).toBeGreaterThan(0);

        alice.rt.simulateReconnectWelcome();
        await vi.advanceTimersByTimeAsync(0);
        await Promise.resolve();

        const joinsAfter = countPairJoins(alice.rt);
        expect(joinsAfter).toBeGreaterThan(joinsBefore);
        void bob;
    });

    it("routes pair signal frames to peerRegistry.handleRemoteSignal", async () => {
        const hub = createTwoPartyHub();
        const { alice, bob } = createTwoPartyStacks(hub);
        await establishPair(hub, alice, bob);

        const handleSpy = vi.spyOn(bob.stack.peerRegistry, "handleRemoteSignal");

        bob.rt.dispatch({
            t: "signal",
            sessionId: pairIdFor("alice", "bob"),
            from: "alice",
            to: "bob",
            kind: "offer",
            sdp: "v=0 test-offer",
        });

        expect(handleSpy).toHaveBeenCalledWith(
            "alice",
            expect.objectContaining({ kind: "offer", sdp: "v=0 test-offer" }),
        );
    });

    it("roster rejoin kicks a negotiating initiator to retransmit its offer", async () => {
        const hub = createTwoPartyHub();
        const alice = createStackFixture(hub, "alice");
        alice.stack.wireRealtimeHandlers({});
        alice.rt.connect();

        const pairId = pairIdFor("alice", "bob");
        void alice.stack.peerRegistry.ensure("bob", "presence_online");
        await Promise.resolve();

        alice.rt.dispatch({
            t: "sessionSnapshot",
            sessionId: pairId,
            joinedParticipants: ["alice", "bob"],
            pendingParticipants: [],
            epoch: 2,
        });

        const alicePeer = mockPeers.find(
            (p) => p.selfAccount === "alice" && p.peerAccount === "bob",
        );
        expect(alicePeer).toBeDefined();
        expect(alice.stack.peerRegistry.getState("bob")).toBe("negotiating");
        const resendCallsBeforeRejoin = alicePeer?.resendOfferCalls ?? 0;

        alice.rt.dispatch({
            t: "participantJoined",
            sessionId: pairId,
            participant: "bob",
        });

        expect(alicePeer?.resendOfferCalls).toBeGreaterThan(
            resendCallsBeforeRejoin,
        );
    });

    it("ignores non-pair sessionSnapshot and signal frames", async () => {
        const hub = createTwoPartyHub();
        const alice = createStackFixture(hub, "alice");
        const snapHandler = vi.fn();
        const signalHandler = vi.fn();
        alice.stack.wireRealtimeHandlers({
            sessionSnapshot: snapHandler,
            signal: signalHandler,
        });

        alice.rt.dispatch({
            t: "sessionSnapshot",
            sessionId: "wrtc:space-old",
            joinedParticipants: ["alice"],
            pendingParticipants: [],
            epoch: 1,
        });
        alice.rt.dispatch({
            t: "signal",
            sessionId: "wrtc:space-old",
            from: "bob",
            to: "alice",
            kind: "offer",
            sdp: "ignored",
        });

        expect(snapHandler).not.toHaveBeenCalled();
        expect(signalHandler).not.toHaveBeenCalled();
    });

    it("fails message after max valid ack attempts (full stack path)", async () => {
        const hub = createTwoPartyHub();
        const { alice, bob } = createTwoPartyStacks(hub);
        hub.setPresence("bob", true);
        await establishPair(hub, alice, bob);
        expect(alice.stack.peerRegistry.getState("bob")).toBe("usable");
        await vi.advanceTimersByTimeAsync(0);
        await Promise.resolve();

        const { msgId } = await alice.stack.messaging.send({
            spaceUuid: "space:dm",
            recipient: "bob",
            body: "timeout",
            autoRetry: true,
        });
        await vi.advanceTimersByTimeAsync(0);
        await Promise.resolve();

        for (let i = 0; i < MAX_VALID_ATTEMPTS; i++) {
            await vi.advanceTimersByTimeAsync(IN_FLIGHT_ACK_WAIT_MS + 1);
            void alice.stack.peerRegistry.ensure("bob", "message_enqueued");
            await Promise.resolve();
        }

        expect(alice.stack.messaging.getStatus(msgId)).toBe("FAILED");
        void bob;
    });

    it("delivers inbound chatMessage through default L4 wire path", async () => {
        const hub = createTwoPartyHub();
        const { alice, bob } = createTwoPartyStacks(hub);
        await establishPair(hub, alice, bob);

        const inbound: ChatDataMessageEnvelope[] = [];
        bob.stack.messaging.onInbound((envelope) => {
            inbound.push({
                t: "chatMessage",
                spaceUuid: envelope.spaceUuid,
                from: envelope.from,
                body: envelope.body,
                sendTimestamp: envelope.sendTimestamp,
                clientMsgId: envelope.clientMsgId,
            });
        });

        const svc = bob.stack.messaging as typeof bob.stack.messaging & {
            handleWireFromRemote: (remote: string, raw: string) => void;
        };
        svc.handleWireFromRemote(
            "alice",
            serializeChatDataMessage({
                t: "chatMessage",
                spaceUuid: "space:dm",
                from: "alice",
                body: "inbound hi",
                sendTimestamp: 42,
                clientMsgId: "msg-in-1",
            }),
        );

        expect(inbound).toEqual([
            expect.objectContaining({ body: "inbound hi", from: "alice" }),
        ]);
        void alice;
    });

    it("supports two independent remotes (alice pairs with bob and charlie)", async () => {
        const hub = createTwoPartyHub();
        const { alice, bob, charlie } = createThreePartyStacks(hub);

        hub.setPresence("bob", true);
        hub.setPresence("charlie", true);

        await establishPair(hub, alice, bob);
        await establishPair(hub, alice, charlie);

        expect(alice.stack.peerRegistry.getState("bob")).toBe("usable");
        expect(alice.stack.peerRegistry.getState("charlie")).toBe("usable");

        const bobPairId = pairIdFor("alice", "bob");
        const charliePairId = pairIdFor("alice", "charlie");

        expect(hub.joinCount(bobPairId)).toBe(2);
        expect(hub.joinCount(charliePairId)).toBe(2);
        void bob;
        void charlie;
    });

    it("dispose removes stack handlers so welcome does not accumulate", () => {
        const rt = new FakeRealtimeClient("alice");
        let transportWelcomeCalls = 0;
        rt.registerHandlers({
            welcome: () => {
                transportWelcomeCalls += 1;
            },
        });

        const makeStack = () =>
            createChatTransportStack({
                localAccount: "alice",
                chainId: "chain-a",
                realtimeClient: rt,
                iceServers: null,
                pairJoinStaggerMs: 0,
                pairJoinRetryMs: 0,
            });

        const stack1 = makeStack();
        stack1.wireRealtimeHandlers({});
        stack1.dispose();

        transportWelcomeCalls = 0;
        rt.simulateReconnectWelcome();
        expect(transportWelcomeCalls).toBe(1);

        const stack2 = makeStack();
        stack2.wireRealtimeHandlers({});
        stack2.dispose();

        transportWelcomeCalls = 0;
        rt.simulateReconnectWelcome();
        expect(transportWelcomeCalls).toBe(1);
    });
});
