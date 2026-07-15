import { beforeEach, describe, expect, it, vi } from "vitest";

import { ChatTransportBridge } from "./chat-transport-bridge";

const stackMock = vi.hoisted(() => {
    const peerHandlers = new Map<string, Set<(remote: string) => void>>();
    const peerRegistry = {
        ensure: vi.fn(),
        kickNegotiation: vi.fn(),
        on: vi.fn((event: string, handler: (remote: string) => void) => {
            const set = peerHandlers.get(event) ?? new Set();
            set.add(handler);
            peerHandlers.set(event, set);
            return () => set.delete(handler);
        }),
        emit(event: string, remote: string) {
            for (const h of peerHandlers.get(event) ?? []) h(remote);
        },
        clearHandlers() {
            peerHandlers.clear();
        },
    };
    const peerLifecycle = {
        ensure: vi.fn(async () => {}),
        notifyRemoteReachable: vi.fn(),
    };
    const deliveryFabric = {
        ensurePeer: vi.fn(async () => {}),
        notifyRemoteReachable: vi.fn(),
        sendPeerBytes: vi.fn(() => ({ ok: true })),
        disposePeer: vi.fn(),
        touchPeer: vi.fn(),
        getPeerState: vi.fn(() => "absent"),
    };
    const messaging = {
        hydrateFromStorage: vi.fn(),
        setFocusedSpace: vi.fn(),
        onInbound: vi.fn(),
        onRecipientDelivered: vi.fn(),
        onStatusChange: vi.fn(),
        acknowledgeInbound: vi.fn(),
    };
    const stack = {
        peerRegistry,
        peerLifecycle,
        deliveryFabric,
        messaging,
        notifyRemoteReachable: vi.fn(),
        wireRealtimeHandlers: vi.fn(),
        dispose: vi.fn(),
    };
    return {
        stack,
        peerRegistry,
        peerLifecycle,
        deliveryFabric,
        messaging,
        createChatTransportStack: vi.fn(() => stack),
    };
});

vi.mock("./stack", () => ({
    createChatTransportStack: stackMock.createChatTransportStack,
}));

vi.mock("../lib/pending-message-store", () => ({
    loadPendingMessages: () => [],
}));

vi.mock("../lib/inbound-acceptance-queue", () => ({
    enqueueInboundAcceptance: vi.fn(),
    clearInboundAcceptanceQueue: vi.fn(() => []),
    dequeueInboundAcceptance: vi.fn(),
}));

vi.mock("../lib/thread-lifecycle", () => ({
    recordThreadLifecycle: vi.fn(),
}));

function createBridge(
    onInboundMessage: (
        envelope: unknown,
    ) => "accepted" | "deferred_contacts" | "rejected" = vi.fn(
        () => "accepted" as const,
    ),
    onPeerUsable: (remote: string) => void = vi.fn(),
): ChatTransportBridge {
    return new ChatTransportBridge({
        getRealtime: () =>
            ({
                registerHandlers: vi.fn(() => () => {}),
                welcomeGeneration: 1,
                isSessionReady: true,
                isReconnectWelcome: () => false,
                sendClientFrame: vi.fn(),
            }) as never,
        getSelf: () => "alice",
        getChainId: () => "test-chain",
        getIceServers: () => null,
        onInboundMessage: onInboundMessage as never,
        onInboundHistorySync: vi.fn(),
        onMessageAck: vi.fn(),
        onPeerUsable,
        onSessionInvite: vi.fn(),
    });
}

const inboundEnvelope = {
    spaceUuid: "space:dm",
    from: "bob",
    body: "hi",
    sendTimestamp: 42,
    clientMsgId: "msg-1",
    remote: "bob",
};

describe("ChatTransportBridge", () => {
    beforeEach(() => {
        stackMock.peerRegistry.clearHandlers();
        stackMock.messaging.onInbound.mockClear();
        stackMock.messaging.acknowledgeInbound.mockClear();
        stackMock.messaging.hydrateFromStorage.mockClear();
        stackMock.messaging.setFocusedSpace.mockClear();
        stackMock.stack.notifyRemoteReachable.mockClear();
        stackMock.deliveryFabric.notifyRemoteReachable.mockClear();
        stackMock.deliveryFabric.ensurePeer.mockClear();
        stackMock.peerRegistry.kickNegotiation.mockClear();
        stackMock.createChatTransportStack.mockClear();
    });

    function latestInboundHandler(): (
        envelope: typeof inboundEnvelope,
    ) => void {
        const calls = stackMock.messaging.onInbound.mock.calls;
        return calls[calls.length - 1]![0] as (
            envelope: typeof inboundEnvelope,
        ) => void;
    }

    it("routes presence online through delivery fabric / peer lifecycle", () => {
        stackMock.deliveryFabric.notifyRemoteReachable.mockClear();

        const bridge = createBridge();
        bridge.start();
        bridge.onPeerOnline("bob");

        expect(
            stackMock.deliveryFabric.notifyRemoteReachable,
        ).toHaveBeenCalledWith("bob", "presence_online");
        expect(stackMock.peerRegistry.kickNegotiation).not.toHaveBeenCalled();
    });

    it("acks inbound chatMessage only after the consumer accepts it", () => {
        stackMock.messaging.onInbound.mockClear();
        stackMock.messaging.acknowledgeInbound.mockClear();

        const bridge = createBridge(() => "accepted");
        bridge.start();

        const handler = latestInboundHandler();
        handler(inboundEnvelope);

        expect(stackMock.messaging.acknowledgeInbound).toHaveBeenCalledWith(
            "bob",
            "space:dm",
            "msg-1",
        );
    });

    it("enqueues deferred contacts instead of acking immediately", async () => {
        const queue = await import("../lib/inbound-acceptance-queue");
        vi.mocked(queue.enqueueInboundAcceptance).mockClear();
        stackMock.messaging.acknowledgeInbound.mockClear();

        const bridge = createBridge(() => "deferred_contacts");
        bridge.start();

        const handler = latestInboundHandler();
        handler(inboundEnvelope);

        expect(queue.enqueueInboundAcceptance).toHaveBeenCalled();
        expect(stackMock.messaging.acknowledgeInbound).not.toHaveBeenCalled();
    });

    it("does not ack inbound chatMessage when the consumer rejects it", () => {
        stackMock.messaging.onInbound.mockClear();
        stackMock.messaging.acknowledgeInbound.mockClear();

        const bridge = createBridge(() => "rejected");
        bridge.start();

        const handler = latestInboundHandler();
        handler(inboundEnvelope);

        expect(stackMock.messaging.acknowledgeInbound).not.toHaveBeenCalled();
    });

    it("ensureChatDataSession skips offline group members", () => {
        stackMock.deliveryFabric.ensurePeer.mockClear();

        const bridge = new ChatTransportBridge({
            getRealtime: () =>
                ({
                    registerHandlers: vi.fn(() => () => {}),
                    welcomeGeneration: 1,
                    isSessionReady: true,
                    isReconnectWelcome: () => false,
                    sendClientFrame: vi.fn(),
                }) as never,
            getSelf: () => "alice",
            getChainId: () => "test-chain",
            getIceServers: () => null,
            onInboundMessage: vi.fn(() => "accepted" as const),
            onInboundHistorySync: vi.fn(),
            onMessageAck: vi.fn(),
            onPeerUsable: vi.fn(),
            onSessionInvite: vi.fn(),
            getRemotePresence: (account) =>
                account === "carol" ? "offline" : "online",
        });
        bridge.start();
        bridge.ensureChatDataSession("space:group", ["alice", "bob", "carol"]);

        expect(stackMock.deliveryFabric.ensurePeer).toHaveBeenCalledTimes(1);
        expect(stackMock.deliveryFabric.ensurePeer).toHaveBeenCalledWith(
            "bob",
            "peer_focus",
        );
    });

    it("ensurePeer skips offline peers for peer_focus", () => {
        stackMock.deliveryFabric.ensurePeer.mockClear();

        const bridge = new ChatTransportBridge({
            getRealtime: () =>
                ({
                    registerHandlers: vi.fn(() => () => {}),
                    welcomeGeneration: 1,
                    isSessionReady: true,
                    isReconnectWelcome: () => false,
                    sendClientFrame: vi.fn(),
                }) as never,
            getSelf: () => "alice",
            getChainId: () => "test-chain",
            getIceServers: () => null,
            onInboundMessage: vi.fn(() => "accepted" as const),
            onInboundHistorySync: vi.fn(),
            onMessageAck: vi.fn(),
            onPeerUsable: vi.fn(),
            onSessionInvite: vi.fn(),
            getRemotePresence: (account) =>
                account === "carol" ? "offline" : "online",
        });
        bridge.start();
        bridge.ensurePeer("carol", "peer_focus");

        expect(stackMock.deliveryFabric.ensurePeer).not.toHaveBeenCalled();
    });

    it("calls onPeerUsable once across two usable events for the same remote", () => {
        const onPeerUsable = vi.fn();
        const bridge = createBridge(undefined, onPeerUsable);
        bridge.start();

        stackMock.peerRegistry.emit("usable", "bob");
        stackMock.peerRegistry.emit("usable", "bob");

        expect(onPeerUsable).toHaveBeenCalledTimes(1);
        expect(onPeerUsable).toHaveBeenCalledWith("bob");
    });

    it("allows onPeerUsable again after dispose of the same remote", () => {
        const onPeerUsable = vi.fn();
        const bridge = createBridge(undefined, onPeerUsable);
        bridge.start();

        stackMock.peerRegistry.emit("usable", "bob");
        stackMock.peerRegistry.emit("disposed", "bob");
        stackMock.peerRegistry.emit("usable", "bob");

        expect(onPeerUsable).toHaveBeenCalledTimes(2);
    });

    it("allows onPeerUsable again after suspected_dead of the same remote", () => {
        const onPeerUsable = vi.fn();
        const bridge = createBridge(undefined, onPeerUsable);
        bridge.start();

        stackMock.peerRegistry.emit("usable", "bob");
        stackMock.peerRegistry.emit("suspected_dead", "bob");
        stackMock.peerRegistry.emit("usable", "bob");

        expect(onPeerUsable).toHaveBeenCalledTimes(2);
    });

    it("hydrates from storage once on start", () => {
        const bridge = createBridge();
        bridge.start();

        expect(stackMock.messaging.hydrateFromStorage).toHaveBeenCalledTimes(1);
    });

    it("forwards setFocusedSpace to messaging", () => {
        const bridge = createBridge();
        bridge.start();
        bridge.setFocusedSpace("space:dm");

        expect(bridge.getFocusedSpace()).toBe("space:dm");
        expect(stackMock.messaging.setFocusedSpace).toHaveBeenCalledWith(
            "space:dm",
        );
    });
});
