import type { RealtimeTransport } from "./l1-realtime-transport";
import type { PeerTransportRegistry } from "./l3-peer-registry";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { serializeChatDataMessage } from "../lib/chat-data-envelope";
import { createMessagingService } from "./l4-messaging-service";
import { IN_FLIGHT_ACK_WAIT_MS, MAX_VALID_ATTEMPTS } from "./types";

function createMockRealtime(
    online: Record<string, boolean> = {},
): RealtimeTransport & {
    emit: (event: string, ...args: unknown[]) => void;
    setOnline: (account: string, online: boolean) => void;
} {
    const presence = new Map(Object.entries(online));
    const handlers = new Map<string, Set<(...args: unknown[]) => void>>();
    return {
        connect: vi.fn(),
        close: vi.fn(),
        dispose: vi.fn(),
        get isReady() {
            return true;
        },
        get welcomeGeneration() {
            return 1;
        },
        on(event, handler) {
            const set = handlers.get(event) ?? new Set();
            set.add(handler as (...args: unknown[]) => void);
            handlers.set(event, set);
            return () => set.delete(handler as (...args: unknown[]) => void);
        },
        send: vi.fn(),
        isRecipientOnline(account) {
            return presence.get(account) === true;
        },
        setOnline(account, online) {
            presence.set(account, online);
        },
        emit(event: string, ...args: unknown[]) {
            for (const h of handlers.get(event) ?? []) h(...args);
        },
    };
}

function createMockPeerRegistry(): PeerTransportRegistry & {
    sent: Array<{ remote: string; bytes: Uint8Array }>;
    emitUsable: (remote: string) => void;
    setState: (
        remote: string,
        state: ReturnType<PeerTransportRegistry["getState"]>,
    ) => void;
} {
    const handlers = new Map<string, Set<(remote: string) => void>>();
    const sent: Array<{ remote: string; bytes: Uint8Array }> = [];
    const states = new Map<
        string,
        ReturnType<PeerTransportRegistry["getState"]>
    >();
    return {
        sent,
        ensure: vi.fn(async () => {}),
        kickNegotiation: vi.fn(),
        getState: vi.fn((remote: string) => states.get(remote) ?? "absent"),
        send(remote, bytes) {
            if (states.get(remote) !== "usable") {
                return { ok: false, reason: "peer_not_ready" };
            }
            sent.push({ remote, bytes });
            return { ok: true };
        },
        on(event, handler) {
            const set = handlers.get(event) ?? new Set();
            set.add(handler as (remote: string) => void);
            handlers.set(event, set);
            return () => set.delete(handler as (remote: string) => void);
        },
        ping: vi.fn(async () => true),
        touch: vi.fn(),
        dispose: vi.fn(),
        handleRemoteSignal: vi.fn(async () => {}),
        getChatPeer: vi.fn(() => null),
        holdMeet: vi.fn(),
        releaseMeet: vi.fn(),
        isMeetHeld: vi.fn(() => false),
        setState(remote, state) {
            states.set(remote, state);
        },
        emitUsable(remote: string) {
            states.set(remote, "usable");
            for (const h of handlers.get("usable") ?? []) h(remote);
        },
    };
}

describe("l4-messaging-service", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        localStorage.clear();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("persists on send and flushes when peer becomes usable", async () => {
        const realtime = createMockRealtime({ bob: false });
        const peerRegistry = createMockPeerRegistry();
        const messaging = createMessagingService({
            localAccount: "alice",
            chainId: "test-chain",
            realtime,
            peerRegistry,
            now: () => 1_000,
        });

        const { msgId } = await messaging.send({
            spaceUuid: "space:dm",
            recipient: "bob",
            body: "hello",
        });

        expect(messaging.getStatus(msgId)).toBe("PENDING");
        expect(peerRegistry.sent).toHaveLength(0);

        (realtime as ReturnType<typeof createMockRealtime>).setOnline(
            "bob",
            true,
        );
        (realtime as ReturnType<typeof createMockRealtime>).emit(
            "presence",
            "bob",
            true,
        );
        peerRegistry.emitUsable("bob");
        await Promise.resolve();

        expect(peerRegistry.sent).toHaveLength(1);
        expect(peerRegistry.sent[0]!.remote).toBe("bob");
    });

    it("sends over usable peer when L1 presence map lagged behind UI", async () => {
        const realtime = createMockRealtime({ bob: false });
        const peerRegistry = createMockPeerRegistry();
        const messaging = createMessagingService({
            localAccount: "alice",
            chainId: "test-chain",
            realtime,
            peerRegistry,
            now: () => 1_000,
        });

        const { msgId } = await messaging.send({
            spaceUuid: "space:dm",
            recipient: "bob",
            body: "hello despite stale presence",
        });
        expect(messaging.getStatus(msgId)).toBe("PENDING");

        peerRegistry.emitUsable("bob");
        await Promise.resolve();

        expect(peerRegistry.sent).toHaveLength(1);
    });

    it("marks DELIVERED on inbound ack", async () => {
        const realtime = createMockRealtime({ bob: true });
        const peerRegistry = createMockPeerRegistry();
        const messaging = createMessagingService({
            localAccount: "alice",
            chainId: "test-chain",
            realtime,
            peerRegistry,
        }) as ReturnType<typeof createMessagingService> & {
            handleWireFromRemote: (remote: string, raw: string) => void;
        };

        const { msgId } = await messaging.send({
            spaceUuid: "space:dm",
            recipient: "bob",
            body: "hello",
        });
        peerRegistry.emitUsable("bob");
        await Promise.resolve();

        messaging.handleWireFromRemote(
            "bob",
            JSON.stringify({
                t: "messageAck",
                spaceUuid: "space:dm",
                clientMsgId: msgId,
                from: "bob",
            }),
        );

        expect(messaging.getStatus(msgId)).toBe("DELIVERED");
    });

    it(`returns to outbox and fails after ${MAX_VALID_ATTEMPTS} valid ack timeouts`, async () => {
        const realtime = createMockRealtime({ bob: true });
        const peerRegistry = createMockPeerRegistry();
        const messaging = createMessagingService({
            localAccount: "alice",
            chainId: "test-chain-timeout",
            realtime,
            peerRegistry,
        });

        const { msgId } = await messaging.send({
            spaceUuid: "space:dm",
            recipient: "bob",
            body: "retry me",
            autoRetry: true,
        });
        peerRegistry.emitUsable("bob");
        await Promise.resolve();

        for (let i = 0; i < MAX_VALID_ATTEMPTS; i++) {
            await vi.advanceTimersByTimeAsync(IN_FLIGHT_ACK_WAIT_MS + 1);
            peerRegistry.emitUsable("bob");
            await Promise.resolve();
        }

        expect(messaging.getStatus(msgId)).toBe("FAILED");
    });

    it("fan-outs group send to each recipient", async () => {
        const realtime = createMockRealtime({ bob: true, carol: true });
        const peerRegistry = createMockPeerRegistry();
        const messaging = createMessagingService({
            localAccount: "alice",
            chainId: "test-chain-group",
            realtime,
            peerRegistry,
        });

        await messaging.sendGroup({
            spaceUuid: "space:group",
            recipient: "bob",
            recipients: ["bob", "carol"],
            body: "group hi",
        });

        peerRegistry.emitUsable("bob");
        peerRegistry.emitUsable("carol");
        await Promise.resolve();

        expect(peerRegistry.sent.map((s) => s.remote).sort()).toEqual([
            "bob",
            "carol",
        ]);
    });

    it("getPendingCount tracks per-recipient delivery", async () => {
        const realtime = createMockRealtime({ bob: true, carol: true });
        const peerRegistry = createMockPeerRegistry();
        const messaging = createMessagingService({
            localAccount: "alice",
            chainId: "test-chain-count",
            realtime,
            peerRegistry,
        }) as ReturnType<typeof createMessagingService> & {
            handleWireFromRemote: (remote: string, raw: string) => void;
        };

        const { msgId } = await messaging.sendGroup({
            spaceUuid: "space:group",
            recipient: "bob",
            recipients: ["bob", "carol"],
            body: "partial",
        });
        peerRegistry.emitUsable("bob");
        peerRegistry.emitUsable("carol");
        await Promise.resolve();

        messaging.handleWireFromRemote(
            "bob",
            JSON.stringify({
                t: "messageAck",
                spaceUuid: "space:group",
                clientMsgId: msgId,
                from: "bob",
            }),
        );

        expect(messaging.getPendingCount(msgId)).toEqual({
            delivered: 1,
            total: 2,
        });

        messaging.handleWireFromRemote(
            "carol",
            JSON.stringify({
                t: "messageAck",
                spaceUuid: "space:group",
                clientMsgId: msgId,
                from: "carol",
            }),
        );

        expect(messaging.getPendingCount(msgId)).toEqual({
            delivered: 0,
            total: 0,
        });
        expect(messaging.getStatus(msgId)).toBe("DELIVERED");
    });

    it("partial group ACK leaves pending until the offline recipient never acks", async () => {
        const realtime = createMockRealtime({ bob: true, carol: false });
        const peerRegistry = createMockPeerRegistry();
        const messaging = createMessagingService({
            localAccount: "alice",
            chainId: "test-chain-partial-offline",
            realtime,
            peerRegistry,
        }) as ReturnType<typeof createMessagingService> & {
            handleWireFromRemote: (remote: string, raw: string) => void;
        };

        const { msgId } = await messaging.sendGroup({
            spaceUuid: "space:group",
            recipient: "bob",
            recipients: ["bob", "carol"],
            body: "one offline",
        });
        peerRegistry.emitUsable("bob");
        await Promise.resolve();

        messaging.handleWireFromRemote(
            "bob",
            JSON.stringify({
                t: "messageAck",
                spaceUuid: "space:group",
                clientMsgId: msgId,
                from: "bob",
            }),
        );

        expect(messaging.getPendingCount(msgId)).toEqual({
            delivered: 1,
            total: 2,
        });
        expect(messaging.getStatus(msgId)).not.toBe("DELIVERED");
        // carol never becomes usable / never ACKs — stays partial.
        expect(peerRegistry.sent.map((s) => s.remote)).toEqual(["bob"]);
    });

    it("does not auto-ack inbound chatMessage on wire parse", async () => {
        const realtime = createMockRealtime({ alice: true });
        const peerRegistry = createMockPeerRegistry();
        const messaging = createMessagingService({
            localAccount: "bob",
            chainId: "test-chain-inbound",
            realtime,
            peerRegistry,
        }) as ReturnType<typeof createMessagingService> & {
            handleWireFromRemote: (remote: string, raw: string) => void;
        };
        peerRegistry.emitUsable("alice");

        const inbound: Array<{ clientMsgId: string; remote: string }> = [];
        messaging.onInbound((envelope) => {
            inbound.push({
                clientMsgId: envelope.clientMsgId,
                remote: envelope.remote,
            });
        });

        messaging.handleWireFromRemote(
            "alice",
            serializeChatDataMessage({
                t: "chatMessage",
                spaceUuid: "space:dm",
                from: "alice",
                body: "hi",
                sendTimestamp: 42,
                clientMsgId: "msg-in-1",
            }),
        );

        expect(inbound).toEqual([{ clientMsgId: "msg-in-1", remote: "alice" }]);
        expect(peerRegistry.sent).toHaveLength(0);
    });

    it("acknowledgeInbound sends a messageAck to the wire remote", () => {
        const realtime = createMockRealtime({ alice: true });
        const peerRegistry = createMockPeerRegistry();
        const messaging = createMessagingService({
            localAccount: "bob",
            chainId: "test-chain-ack",
            realtime,
            peerRegistry,
        });
        peerRegistry.emitUsable("alice");

        messaging.acknowledgeInbound("alice", "space:dm", "msg-in-1");

        expect(peerRegistry.sent).toHaveLength(1);
        const { remote, bytes } = peerRegistry.sent[0]!;
        expect(remote).toBe("alice");
        expect(JSON.parse(new TextDecoder().decode(bytes))).toEqual({
            t: "messageAck",
            spaceUuid: "space:dm",
            clientMsgId: "msg-in-1",
            from: "bob",
        });
    });

    it("retries accepted inbound acks when the peer becomes usable", () => {
        const realtime = createMockRealtime({ alice: true });
        const peerRegistry = createMockPeerRegistry();
        const messaging = createMessagingService({
            localAccount: "bob",
            chainId: "test-chain-ack-retry",
            realtime,
            peerRegistry,
        });

        messaging.acknowledgeInbound("alice", "space:group", "msg-in-1");

        expect(peerRegistry.sent).toHaveLength(0);
        expect(peerRegistry.ensure).toHaveBeenCalledWith(
            "alice",
            "message_enqueued",
        );

        peerRegistry.emitUsable("alice");

        expect(peerRegistry.sent).toHaveLength(1);
        const { remote, bytes } = peerRegistry.sent[0]!;
        expect(remote).toBe("alice");
        expect(JSON.parse(new TextDecoder().decode(bytes))).toEqual({
            t: "messageAck",
            spaceUuid: "space:group",
            clientMsgId: "msg-in-1",
            from: "bob",
        });
    });

    it("persists pending acks across remount and sends on peer usable", () => {
        const chainId = "test-chain-ack-persist";
        const realtime1 = createMockRealtime({ alice: true });
        const peerRegistry1 = createMockPeerRegistry();
        const messaging1 = createMessagingService({
            localAccount: "bob",
            chainId,
            realtime: realtime1,
            peerRegistry: peerRegistry1,
        });

        messaging1.acknowledgeInbound("alice", "space:group", "msg-persist-1");
        expect(peerRegistry1.sent).toHaveLength(0);

        const realtime2 = createMockRealtime({ alice: true });
        const peerRegistry2 = createMockPeerRegistry();
        const messaging2 = createMessagingService({
            localAccount: "bob",
            chainId,
            realtime: realtime2,
            peerRegistry: peerRegistry2,
        });

        expect(peerRegistry2.sent).toHaveLength(0);
        peerRegistry2.emitUsable("alice");

        expect(peerRegistry2.sent).toHaveLength(1);
        const { remote, bytes } = peerRegistry2.sent[0]!;
        expect(remote).toBe("alice");
        expect(JSON.parse(new TextDecoder().decode(bytes))).toEqual({
            t: "messageAck",
            spaceUuid: "space:group",
            clientMsgId: "msg-persist-1",
            from: "bob",
        });
    });

    it("does not dispose on ACK timeout when peer is Meet-held", async () => {
        const realtime = createMockRealtime({ bob: true });
        const peerRegistry = createMockPeerRegistry();
        peerRegistry.ping = vi.fn(async () => false);
        peerRegistry.isMeetHeld = vi.fn(() => true);

        const messaging = createMessagingService({
            localAccount: "alice",
            chainId: "test-chain-ack-meet-held",
            realtime,
            peerRegistry,
        });

        await messaging.send({
            spaceUuid: "space:dm",
            recipient: "bob",
            body: "during meet",
        });
        peerRegistry.emitUsable("bob");
        await Promise.resolve();

        await vi.advanceTimersByTimeAsync(IN_FLIGHT_ACK_WAIT_MS + 1);
        await Promise.resolve();

        expect(peerRegistry.dispose).not.toHaveBeenCalled();
        expect(peerRegistry.isMeetHeld).toHaveBeenCalledWith("bob");
    });

    it("disposes on ACK timeout when ping fails and peer is not Meet-held", async () => {
        const realtime = createMockRealtime({ bob: true });
        const peerRegistry = createMockPeerRegistry();
        peerRegistry.ping = vi.fn(async () => false);
        peerRegistry.isMeetHeld = vi.fn(() => false);

        const messaging = createMessagingService({
            localAccount: "alice",
            chainId: "test-chain-ack-dispose",
            realtime,
            peerRegistry,
        });

        await messaging.send({
            spaceUuid: "space:dm",
            recipient: "bob",
            body: "no meet",
        });
        peerRegistry.emitUsable("bob");
        await Promise.resolve();

        await vi.advanceTimersByTimeAsync(IN_FLIGHT_ACK_WAIT_MS + 1);
        await Promise.resolve();

        expect(peerRegistry.dispose).toHaveBeenCalledWith("bob", "ack_timeout");
    });
});
