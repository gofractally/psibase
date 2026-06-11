import { beforeEach, describe, expect, it, vi } from "vitest";

import { ChatTransportBridge } from "./chat-transport-bridge";

const stackMock = vi.hoisted(() => {
    const peerRegistry = {
        ensure: vi.fn(),
        kickNegotiation: vi.fn(),
        on: vi.fn(() => () => {}),
    };
    const messaging = {
        hydrateFromStorage: vi.fn(),
        onInbound: vi.fn(),
        onRecipientDelivered: vi.fn(),
        onStatusChange: vi.fn(),
        acknowledgeInbound: vi.fn(),
    };
    const stack = {
        peerRegistry,
        messaging,
        notifyRemoteReachable: vi.fn(),
        wireRealtimeHandlers: vi.fn(),
        dispose: vi.fn(),
    };
    return {
        stack,
        peerRegistry,
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
        onPeerUsable: vi.fn(),
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
        stackMock.messaging.onInbound.mockClear();
        stackMock.messaging.acknowledgeInbound.mockClear();
        stackMock.stack.notifyRemoteReachable.mockClear();
        stackMock.peerRegistry.kickNegotiation.mockClear();
    });

    function latestInboundHandler(): (
        envelope: typeof inboundEnvelope,
    ) => void {
        const calls = stackMock.messaging.onInbound.mock.calls;
        return calls[calls.length - 1]![0] as (
            envelope: typeof inboundEnvelope,
        ) => void;
    }

    it("routes presence online through roster coordinator", () => {
        stackMock.stack.notifyRemoteReachable.mockClear();

        const bridge = createBridge();
        bridge.start();
        bridge.onPeerOnline("bob");

        expect(stackMock.stack.notifyRemoteReachable).toHaveBeenCalledWith(
            "bob",
            "presence_online",
        );
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
        stackMock.peerRegistry.ensure.mockClear();

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
        bridge.ensureChatDataSession("space:group", [
            "alice",
            "bob",
            "carol",
        ]);

        expect(stackMock.peerRegistry.ensure).toHaveBeenCalledTimes(1);
        expect(stackMock.peerRegistry.ensure).toHaveBeenCalledWith(
            "bob",
            "peer_focus",
        );
    });

    it("ensurePeer skips offline peers for peer_focus", () => {
        stackMock.peerRegistry.ensure.mockClear();

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

        expect(stackMock.peerRegistry.ensure).not.toHaveBeenCalled();
    });
});
