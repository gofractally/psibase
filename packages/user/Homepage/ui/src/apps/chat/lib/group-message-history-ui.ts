import {
    buildGroupEnvelope,
    type GroupMessageEnvelope,
    mergeGroupEnvelopesBySendTimestamp,
} from "./group-message-history-store";

/** Minimal message row shape for group history restore (maps to timeline message rows). */
export type GroupHistoryTimelineMessage = {
    kind: "message";
    key: string;
    clientMsgId?: string;
    serverMsgId?: number;
    from: string;
    body: string;
    serverTime: number;
    status: "sent" | "pending" | "failed";
};

export function envelopeToTimelineMessage(
    envelope: GroupMessageEnvelope,
): GroupHistoryTimelineMessage {
    return {
        kind: "message",
        key: envelope.localId,
        clientMsgId: envelope.clientMsgId,
        serverMsgId: envelope.serverMsgId,
        from: envelope.from,
        body: envelope.body,
        serverTime: envelope.sendTimestamp,
        status: "sent",
    };
}

type TimelineMessageLike = Pick<
    GroupHistoryTimelineMessage,
    "key" | "clientMsgId" | "serverMsgId" | "from" | "body" | "serverTime"
>;

export function mergeTimelineMessagesBySendTimestamp<
    T extends TimelineMessageLike,
>(
    existingMessages: readonly T[],
    historyEnvelopes: readonly GroupMessageEnvelope[],
): GroupHistoryTimelineMessage[] {
    const fromExisting = existingMessages.map((row) =>
        buildGroupEnvelope({
            ownerAccount: "",
            spaceUuid: "",
            from: row.from,
            body: row.body,
            sendTimestamp: row.serverTime,
            clientMsgId: row.clientMsgId,
            serverMsgId: row.serverMsgId,
            fallbackKey: row.key,
        }),
    );
    const merged = mergeGroupEnvelopesBySendTimestamp(
        fromExisting,
        historyEnvelopes,
    );
    return merged.map(envelopeToTimelineMessage);
}
