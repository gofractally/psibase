import type { ChatHistorySyncEnvelope } from "./chat-data-envelope";
import { shouldPushHistoryOnConnect } from "./catch-up-policy";
import {
    buildGroupEnvelope,
    type GroupMessageEnvelope,
} from "./group-message-history-store";

/** Existing online peer pushes; late-joiner waits for inbound sync (architecture §5.3). */
export function shouldPushGroupHistoryOnConnect(
    peerWasOnlineAtSessionStart: boolean,
    options?: {
        peerIsOnlineNow?: boolean;
        hadOpenDataChannel?: boolean;
    },
): boolean {
    return shouldPushHistoryOnConnect({
        peerWasOnlineAtSessionStart,
        peerIsOnlineNow: options?.peerIsOnlineNow ?? true,
        hadOpenDataChannel: options?.hadOpenDataChannel ?? false,
    });
}

export function historySyncToGroupEnvelopes(
    selfAccount: string,
    spaceUuid: string,
    sync: ChatHistorySyncEnvelope,
): GroupMessageEnvelope[] {
    return sync.messages.map((item) =>
        buildGroupEnvelope({
            ownerAccount: selfAccount,
            spaceUuid,
            from: item.from,
            body: item.body,
            sendTimestamp: item.sendTimestamp,
            clientMsgId: item.clientMsgId,
        }),
    );
}
