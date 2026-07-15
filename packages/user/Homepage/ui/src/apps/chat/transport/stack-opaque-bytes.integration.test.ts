/**
 * L3→L4 opaque-bytes contract: peerRegistry.send forwards serialized bytes
 * without understanding chat `t:` types; L4 owns parse / inbound.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    serializeChatDataMessage,
    type ChatDataMessageEnvelope,
} from "../lib/chat-data-envelope";
import type { ChatDataPeerHandlers } from "../lib/chat-data-webrtc-peer";
import {
    createTwoPartyHub,
    createTwoPartyStacks,
    establishPair,
} from "./stack-test-harness";

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

        /** Raw wire payloads passed to sendWireBytes (opaque from L3's POV). */
        sentWireBytes: Uint8Array[] = [];

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

        sendWireBytes(bytes: Uint8Array): boolean {
            if (!this.dataChannelReady) return false;
            this.sentWireBytes.push(bytes);
            return true;
        }

        sendChatMessage(): boolean {
            return this.dataChannelReady;
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

        resendOffer(): void {}

        restartIce(): void {}

        stopMeetMedia(): void {}

        dispose(): void {
            this.disposed = true;
            this.dataChannelReady = false;
        }

        async handleRemoteSignal(): Promise<void> {}
    }

    return { mockPeers, MockChatDataWebRtcPeer };
});

vi.mock("../lib/chat-data-webrtc-peer", () => ({
    ChatDataWebRtcPeer: peerMock.MockChatDataWebRtcPeer,
}));

const { mockPeers } = peerMock;

function findPeer(self: string, remote: string) {
    return mockPeers.find(
        (p) =>
            !p.isDisposed &&
            p.selfAccount === self &&
            p.peerAccount === remote,
    );
}

describe("L3→L4 opaque bytes integration", () => {
    beforeEach(() => {
        mockPeers.length = 0;
        localStorage.clear();
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("peerRegistry.send forwards opaque bytes via sendWireBytes without chat t: parse", async () => {
        const hub = createTwoPartyHub();
        const { alice, bob } = createTwoPartyStacks(hub);
        await establishPair(hub, alice, bob);
        await Promise.resolve();

        const alicePeer = findPeer("alice", "bob");
        expect(alicePeer).toBeDefined();
        const sendSpy = vi.spyOn(alicePeer!, "sendWireBytes");

        // Unknown envelope type — L3 must not throw or require a known `t:`.
        const opaque = new TextEncoder().encode(
            JSON.stringify({ t: "futureWidget", payload: [1, 2, 3] }),
        );
        const result = alice.stack.peerRegistry.send("bob", opaque);

        expect(result).toEqual({ ok: true });
        expect(sendSpy).toHaveBeenCalledTimes(1);
        expect(sendSpy.mock.calls[0]![0]).toEqual(opaque);
        void bob;
    });

    it("messaging.send → sendWireBytes bytes → peer handleWireFromRemote inbound", async () => {
        const hub = createTwoPartyHub();
        const { alice, bob } = createTwoPartyStacks(hub);
        await establishPair(hub, alice, bob);
        hub.setPresence("bob", true);
        await Promise.resolve();

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

        const alicePeer = findPeer("alice", "bob");
        expect(alicePeer).toBeDefined();

        const { msgId } = await alice.stack.messaging.send({
            spaceUuid: "space:dm",
            recipient: "bob",
            body: "opaque round-trip",
        });
        await Promise.resolve();

        expect(alicePeer!.sentWireBytes.length).toBeGreaterThanOrEqual(1);
        const wire = alicePeer!.sentWireBytes.at(-1)!;
        const raw = new TextDecoder().decode(wire);
        // Bytes are a serialized chat envelope; L3 never inspected `t`.
        expect(JSON.parse(raw)).toEqual(
            expect.objectContaining({
                t: "chatMessage",
                body: "opaque round-trip",
                clientMsgId: msgId,
            }),
        );

        const svc = bob.stack.messaging as typeof bob.stack.messaging & {
            handleWireFromRemote: (remote: string, raw: string) => void;
        };
        svc.handleWireFromRemote("alice", raw);

        expect(inbound).toEqual([
            expect.objectContaining({
                body: "opaque round-trip",
                from: "alice",
                clientMsgId: msgId,
            }),
        ]);
    });

    it("serialized envelope bytes survive peerRegistry.send unchanged", async () => {
        const hub = createTwoPartyHub();
        const { alice, bob } = createTwoPartyStacks(hub);
        await establishPair(hub, alice, bob);
        await Promise.resolve();

        const alicePeer = findPeer("alice", "bob");
        const envelope = serializeChatDataMessage({
            t: "chatMessage",
            spaceUuid: "space:dm",
            from: "alice",
            body: "contract",
            sendTimestamp: 99,
            clientMsgId: "msg-contract-1",
        });
        const bytes = new TextEncoder().encode(envelope);
        const result = alice.stack.peerRegistry.send("bob", bytes);

        expect(result).toEqual({ ok: true });
        expect(alicePeer!.sentWireBytes.at(-1)).toEqual(bytes);
        void bob;
    });
});
