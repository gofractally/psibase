import {
    buildDmEnvelope,
    type DmMessageEnvelope,
    mergeEnvelopesBySendTimestamp,
} from "./dm-message-history-store";

/** Minimal message row shape for history restore (maps to timeline message rows). */
export type DmHistoryTimelineMessage = {
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
    envelope: DmMessageEnvelope,
): DmHistoryTimelineMessage {
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
    DmHistoryTimelineMessage,
    "key" | "clientMsgId" | "serverMsgId" | "from" | "body" | "serverTime"
>;

export function mergeTimelineMessagesBySendTimestamp<
    T extends TimelineMessageLike,
>(
    existingMessages: readonly T[],
    historyEnvelopes: readonly DmMessageEnvelope[],
): DmHistoryTimelineMessage[] {
    const fromExisting = existingMessages.map((row) =>
        buildDmEnvelope({
            ownerAccount: "",
            spaceUuid: "",
            peerAccount: "",
            from: row.from,
            body: row.body,
            sendTimestamp: row.serverTime,
            clientMsgId: row.clientMsgId,
            serverMsgId: row.serverMsgId,
            fallbackKey: row.key,
        }),
    );
    const merged = mergeEnvelopesBySendTimestamp(fromExisting, historyEnvelopes);
    return merged.map(envelopeToTimelineMessage);
}
