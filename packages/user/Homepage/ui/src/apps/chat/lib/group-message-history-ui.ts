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

/**
 * Merge durable group history into live timeline rows without dropping local
 * pending/failed optimistic rows. History restore/sync can run while a send is
 * still waiting on one recipient ack; filtering to only sent rows would make
 * the sender's own message disappear until another pending update happens.
 */
export function mergeTimelineMessagesWithGroupHistory(
    existingMessages: readonly GroupHistoryTimelineMessage[],
    historyEnvelopes: readonly GroupMessageEnvelope[],
): GroupHistoryTimelineMessage[] {
    const unsent = existingMessages.filter((row) => row.status !== "sent");
    const mergedSent = mergeTimelineMessagesBySendTimestamp(
        existingMessages.filter((row) => row.status === "sent"),
        historyEnvelopes,
    ).map((row) => {
        const pending = unsent.find(
            (existingRow) =>
                existingRow.clientMsgId &&
                existingRow.clientMsgId === row.clientMsgId,
        );
        return pending ? { ...row, ...pending } : row;
    });

    const mergedClientIds = new Set(
        mergedSent
            .map((row) => row.clientMsgId)
            .filter((id): id is string => typeof id === "string"),
    );
    const retainedUnsent = unsent.filter(
        (row) => !row.clientMsgId || !mergedClientIds.has(row.clientMsgId),
    );

    return [...mergedSent, ...retainedUnsent].sort((a, b) => {
        const ts = a.serverTime - b.serverTime;
        if (ts !== 0) return ts;
        return a.key.localeCompare(b.key);
    });
}
