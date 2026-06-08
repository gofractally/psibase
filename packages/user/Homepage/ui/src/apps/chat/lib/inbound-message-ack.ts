export type InboundAckTarget = {
    remote: string;
    spaceUuid: string;
    clientMsgId: string;
};

/** One ack per (sender, space, clientMsgId) for inbound/history-synced messages. */
export function listInboundAckTargets(
    messages: ReadonlyArray<{
        from: string;
        spaceUuid: string;
        clientMsgId?: string;
    }>,
    selfAccount: string,
): InboundAckTarget[] {
    const seen = new Set<string>();
    const targets: InboundAckTarget[] = [];
    for (const message of messages) {
        if (message.from === selfAccount || !message.clientMsgId) continue;
        const key = `${message.from}\0${message.spaceUuid}\0${message.clientMsgId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        targets.push({
            remote: message.from,
            spaceUuid: message.spaceUuid,
            clientMsgId: message.clientMsgId,
        });
    }
    return targets;
}
