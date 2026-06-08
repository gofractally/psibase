import { useRef, type MutableRefObject } from "react";

import type {
    ChatDataMessageAckEnvelope,
    ChatDataMessageEnvelope,
    ChatHistorySyncEnvelope,
} from "../../lib/chat-data-envelope";
import type { IceServerConfig } from "../../lib/protocol";
import type { RealtimeClient } from "../../lib/realtime-client";
import { ChatTransportBridge } from "../../transport-v2/chat-transport-bridge";

export type ChatTransportBridgeDeps = {
    getRealtime: () => RealtimeClient | null;
    getSelf: () => string | null;
    getChainId: () => string | null;
    getIceServers: () => IceServerConfig[] | null;
    /** Returns true when the message was accepted (triggers the wire ack). */
    onInboundMessage: (envelope: ChatDataMessageEnvelope) => boolean;
    onInboundHistorySync: (envelope: ChatHistorySyncEnvelope) => void;
    onMessageAck: (
        spaceUuid: string,
        envelope: ChatDataMessageAckEnvelope,
    ) => void;
    onPeerUsable: (remoteAccount: string) => void;
    onSessionInvite: (spaceUuid: string) => void;
    onSpaceMembershipHint?: (from: string) => void;
};

/** Construct v2 per-peer chat transport for a hook lifetime. */
export function createChatTransportBridge(
    deps: ChatTransportBridgeDeps,
): ChatTransportBridge {
    return new ChatTransportBridge(deps);
}

export function useChatTransportBridgeRef(): MutableRefObject<ChatTransportBridge | null> {
    return useRef<ChatTransportBridge | null>(null);
}

/** @deprecated Use {@link createChatTransportBridge}. */
export const createChatDataOrchestratorBridge = createChatTransportBridge;

export type ChatOrchestratorBridgeDeps = ChatTransportBridgeDeps;

export function useChatOrchestratorRef(): MutableRefObject<ChatTransportBridge | null> {
    return useChatTransportBridgeRef();
}
