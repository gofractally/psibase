import { useRef, type MutableRefObject } from "react";

import { ChatDataSessionOrchestrator } from "../../lib/chat-data-session-orchestrator";
import type {
    ChatDataMessageAckEnvelope,
    ChatDataMessageEnvelope,
    ChatHistorySyncEnvelope,
} from "../../lib/chat-data-envelope";
import type { ChatDataSessionSnapshot } from "../../lib/chat-data-session-orchestrator";
import type { IceServerConfig } from "../../lib/protocol";
import type { RealtimeClient } from "../../lib/realtime-client";
import type { ConversationSnapshot } from "../../lib/protocol";

export type ChatOrchestratorBridgeDeps = {
    getRealtime: () => RealtimeClient | null;
    getSelf: () => string | null;
    getIceServers: () => IceServerConfig[] | null;
    getPresence: () => Record<string, string>;
    onFlushPending: (options?: {
        forceRecipients?: ReadonlySet<string>;
    }) => void;
    getConversations: () => ConversationSnapshot[];
    onInboundMessage: (envelope: ChatDataMessageEnvelope) => void;
    onInboundHistorySync: (envelope: ChatHistorySyncEnvelope) => void;
    onDataChannelReady: (
        spaceUuid: string,
        info: { peerAccount: string; shouldPushHistory: boolean },
    ) => void;
    onSessionInvite: (spaceUuid: string) => void;
    /**
     * Plan F7: app-level delivery ack. Called when the remote peer
     * confirms receipt of a chat message we sent over the data channel.
     */
    onMessageAck: (
        spaceUuid: string,
        envelope: ChatDataMessageAckEnvelope,
    ) => void;
    /**
     * Plan F7 retry-on-reopen: drop any in-flight dedup tracking for
     * `recipient` so a freshly opened data channel can immediately
     * re-send unacked messages without the 5s window blocking it.
     */
    onPeerChannelReopened?: (recipient: string) => void;
};

/** Construct and own the chat-data session orchestrator for a hook lifetime. */
export function createChatDataOrchestratorBridge(
    deps: ChatOrchestratorBridgeDeps,
): ChatDataSessionOrchestrator {
    return new ChatDataSessionOrchestrator(
        deps.getRealtime,
        deps.getSelf,
        deps.getIceServers,
        deps.getPresence,
        (_spaceUuid: string, snap: ChatDataSessionSnapshot) => {
            const anyMeshReady =
                snap.meshPeerReady &&
                Object.values(snap.meshPeerReady).some(Boolean);
            if (
                snap.dataChannelReady ||
                snap.phase === "ready" ||
                anyMeshReady
            ) {
                globalThis.setTimeout(() => deps.onFlushPending(), 0);
            }
        },
        (_spaceUuid, envelope) => deps.onInboundMessage(envelope),
        (_spaceUuid, envelope) => deps.onInboundHistorySync(envelope),
        (spaceUuid, info) => {
            // Plan F7 retry-on-reopen: a freshly opened data channel
            // for a recipient means any previous unacked write to that
            // recipient on the OLD peer connection is presumed lost.
            // Bypass the in-flight dedup by clearing those entries
            // before the SM-driven force flush re-emits them.
            deps.onPeerChannelReopened?.(info.peerAccount);
            globalThis.setTimeout(
                () =>
                    deps.onFlushPending({
                        forceRecipients: new Set([info.peerAccount]),
                    }),
                0,
            );
            deps.onDataChannelReady(spaceUuid, info);
        },
        deps.onSessionInvite,
        (_spaceUuid, recipients) => {
            const set = new Set(recipients);
            globalThis.setTimeout(
                () => deps.onFlushPending({ forceRecipients: set }),
                0,
            );
        },
        (spaceUuid, envelope) => deps.onMessageAck(spaceUuid, envelope),
    );
}

export function useChatOrchestratorRef(): MutableRefObject<ChatDataSessionOrchestrator | null> {
    return useRef<ChatDataSessionOrchestrator | null>(null);
}
