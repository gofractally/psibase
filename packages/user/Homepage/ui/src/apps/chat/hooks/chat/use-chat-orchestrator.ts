import { useRef, type MutableRefObject } from "react";

import type {
    ChatDataMessageAckEnvelope,
    ChatDataMessageEnvelope,
    ChatHistorySyncEnvelope,
} from "../../lib/chat-data-envelope";
import type { InboundMessageAcceptance } from "../../lib/inbound-message-acceptance";
import type { IceServerConfig } from "../../lib/protocol";
import type { RealtimeClient } from "../../lib/realtime-client";
import { ChatTransportBridge } from "../../transport/chat-transport-bridge";

export type ChatTransportBridgeDeps = {
    getRealtime: () => RealtimeClient | null;
    getSelf: () => string | null;
    getChainId: () => string | null;
    getIceServers: () => IceServerConfig[] | null;
    onInboundMessage: (
        envelope: ChatDataMessageEnvelope,
    ) => InboundMessageAcceptance;
    onInboundHistorySync: (envelope: ChatHistorySyncEnvelope) => void;
    onMessageAck: (
        spaceUuid: string,
        envelope: ChatDataMessageAckEnvelope,
    ) => void;
    onPeerUsable: (remoteAccount: string) => void;
    onSessionInvite: (spaceUuid: string) => void;
    onSpaceMembershipHint?: (from: string) => void;
    getRemotePresence?: (account: string) => "online" | "offline" | undefined;
};

/** Construct per-peer chat transport for a hook lifetime. */
export function createChatTransportBridge(
    deps: ChatTransportBridgeDeps,
): ChatTransportBridge {
    return new ChatTransportBridge(deps);
}

export function useChatTransportBridgeRef(): MutableRefObject<ChatTransportBridge | null> {
    return useRef<ChatTransportBridge | null>(null);
}
