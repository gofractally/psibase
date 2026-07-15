import type { ChatHistorySyncEnvelope } from "./chat-data-envelope";
import { shouldPushHistoryOnConnect } from "./catch-up-policy";
import {
    buildGroupEnvelope,
    type GroupMessageEnvelope,
} from "./group-message-history-store";
import type { ConversationSnapshot } from "./protocol";
import type { GraphqlSpaceEntry } from "./space-bridge";

/** Existing online peer pushes; late-joiner waits for inbound sync. */
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

/** Resolve group roster for history sync even before contacts-filtered conversations load. */
export function resolveGroupMembersForHistorySync(
    spaceUuid: string,
    conversations: readonly ConversationSnapshot[],
    spaces: readonly GraphqlSpaceEntry[],
): readonly string[] | null {
    const conversation = conversations.find(
        (row) => row.conversationId === spaceUuid,
    );
    if (conversation?.kind === "group") return conversation.members;
    const entry = spaces.find((row) => row.space_uuid === spaceUuid);
    if (entry?.kind === "GROUP") return entry.members;
    return null;
}

export function isGroupHistorySyncSpace(
    spaceUuid: string,
    conversations: readonly ConversationSnapshot[],
    spaces: readonly GraphqlSpaceEntry[],
): boolean {
    return resolveGroupMembersForHistorySync(spaceUuid, conversations, spaces) != null;
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
