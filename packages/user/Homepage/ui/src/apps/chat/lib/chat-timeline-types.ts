import type { CallTimelineEventType } from "./protocol";
import type { PendingChatMessage } from "./pending-message-store";

export type ChatMessageStatus = "pending" | "sent" | "failed";

/** One plain chat bubble row (outbound correlates via clientMsgId). */
export type ChatUiMessage = {
    /** Stable React key — clientMsgId for optimistic rows, else `srv-${serverMsgId}`. */
    key: string;
    clientMsgId?: string;
    serverMsgId?: number;
    from: string;
    body: string;
    serverTime: number;
    status: ChatMessageStatus;
    errorReason?: string;
    pendingRecipientCount?: number;
};

export type ChatTimelineMessageRow = ChatUiMessage & { kind: "message" };

export type ChatTimelineCallEventRow = {
    kind: "callEvent";
    key: string;
    conversationId: string;
    callId?: string;
    event: CallTimelineEventType;
    actor?: string;
    reason?: string;
    durationMs?: number;
    serverMsgId: number;
    serverTime: number;
};

export type ChatTimelineRow =
    | ChatTimelineMessageRow
    | ChatTimelineCallEventRow;

export type PresenceUi = "online" | "offline" | "unknown";

export function sortTimelineRows(rows: ChatTimelineRow[]): ChatTimelineRow[] {
    return rows.sort((a, b) => a.serverTime - b.serverTime);
}

export function pendingRecipientCount(pending: PendingChatMessage): number {
    const delivered = new Set(pending.deliveredTo);
    return pending.recipients.filter((recipient) => !delivered.has(recipient))
        .length;
}

export function pendingToTimelineRow(
    pending: PendingChatMessage,
): ChatTimelineMessageRow {
    return {
        kind: "message",
        key: pending.clientMsgId,
        clientMsgId: pending.clientMsgId,
        from: pending.from,
        body: pending.body,
        serverTime: pending.createdAt,
        status: pending.status,
        errorReason: pending.errorReason,
        pendingRecipientCount: pendingRecipientCount(pending),
    };
}
