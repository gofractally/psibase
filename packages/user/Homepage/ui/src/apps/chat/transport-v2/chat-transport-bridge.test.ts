import { describe, expect, it, vi } from "vitest";

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

vi.mock("../lib/thread-lifecycle", () => ({
    recordThreadLifecycle: vi.fn(),
}));

function createBridge(
    onInboundMessage: (envelope: unknown) => boolean = vi.fn(() => true),
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
    it("kicks existing peer negotiation when presence reports a peer online", () => {
        stackMock.peerRegistry.ensure.mockClear();
        stackMock.peerRegistry.kickNegotiation.mockClear();

        const bridge = createBridge();
        bridge.start();
        bridge.onPeerOnline("bob");

        expect(stackMock.peerRegistry.ensure).toHaveBeenCalledWith(
            "bob",
            "presence_online",
        );
        expect(stackMock.peerRegistry.kickNegotiation).toHaveBeenCalledWith(
            "bob",
        );
    });

    it("acks inbound chatMessage only after the consumer accepts it", () => {
        stackMock.messaging.onInbound.mockClear();
        stackMock.messaging.acknowledgeInbound.mockClear();

        const bridge = createBridge(() => true);
        bridge.start();

        const handler = stackMock.messaging.onInbound.mock.calls[0]![0] as (
            envelope: typeof inboundEnvelope,
        ) => void;
        handler(inboundEnvelope);

        expect(stackMock.messaging.acknowledgeInbound).toHaveBeenCalledWith(
            "bob",
            "space:dm",
            "msg-1",
        );
    });

    it("does not ack inbound chatMessage when the consumer rejects it", () => {
        stackMock.messaging.onInbound.mockClear();
        stackMock.messaging.acknowledgeInbound.mockClear();

        const bridge = createBridge(() => false);
        bridge.start();

        const handler = stackMock.messaging.onInbound.mock.calls[0]![0] as (
            envelope: typeof inboundEnvelope,
        ) => void;
        handler(inboundEnvelope);

        expect(stackMock.messaging.acknowledgeInbound).not.toHaveBeenCalled();
    });
});
