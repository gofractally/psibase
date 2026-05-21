import type { ChatHistorySyncEnvelope } from "./chat-data-envelope";
import {
    buildDmEnvelope,
    type DmMessageEnvelope,
} from "./dm-message-history-store";

/** Existing online peer pushes; joiner waits for inbound sync. */
export function shouldPushDmHistoryOnConnect(
    peerWasOnlineAtSessionStart: boolean,
): boolean {
    return !peerWasOnlineAtSessionStart;
}

type HistorySyncSourceEnvelope = Pick<
    DmMessageEnvelope,
    "from" | "body" | "sendTimestamp" | "clientMsgId" | "localId"
>;

export function envelopesToHistorySyncMessages(
    envelopes: readonly HistorySyncSourceEnvelope[],
): ChatHistorySyncEnvelope["messages"] {
    return envelopes.map((envelope) => ({
        from: envelope.from,
        body: envelope.body,
        sendTimestamp: envelope.sendTimestamp,
        clientMsgId: envelope.clientMsgId ?? envelope.localId,
    }));
}

export function historySyncToDmEnvelopes(
    selfAccount: string,
    spaceUuid: string,
    peerAccount: string,
    sync: ChatHistorySyncEnvelope,
): DmMessageEnvelope[] {
    return sync.messages.map((item) =>
        buildDmEnvelope({
            ownerAccount: selfAccount,
            spaceUuid,
            peerAccount,
            from: item.from,
            body: item.body,
            sendTimestamp: item.sendTimestamp,
            clientMsgId: item.clientMsgId,
        }),
    );
}
