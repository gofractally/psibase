import type { CallTimelineEventType } from "./protocol";
import type { PendingChatMessage } from "./pending-message-store";

export type PslackMessageStatus = "pending" | "sent" | "failed";

/** One plain chat bubble row (outbound correlates via clientMsgId). */
export type PslackUiMessage = {
    /** Stable React key — clientMsgId for optimistic rows, else `srv-${serverMsgId}`. */
    key: string;
    clientMsgId?: string;
    serverMsgId?: number;
    from: string;
    body: string;
    serverTime: number;
    status: PslackMessageStatus;
    errorReason?: string;
    pendingRecipientCount?: number;
};

export type PslackTimelineMessageRow = PslackUiMessage & { kind: "message" };

export type PslackTimelineCallEventRow = {
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

export type PslackTimelineRow =
    | PslackTimelineMessageRow
    | PslackTimelineCallEventRow;

export type PresenceUi = "online" | "offline" | "unknown";

export function sortTimelineRows(rows: PslackTimelineRow[]): PslackTimelineRow[] {
    return rows.sort((a, b) => a.serverTime - b.serverTime);
}

export function pendingRecipientCount(pending: PendingChatMessage): number {
    const delivered = new Set(pending.deliveredTo);
    return pending.recipients.filter((recipient) => !delivered.has(recipient))
        .length;
}

export function pendingToTimelineRow(
    pending: PendingChatMessage,
): PslackTimelineMessageRow {
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
