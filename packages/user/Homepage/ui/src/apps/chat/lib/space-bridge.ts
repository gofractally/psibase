import type { ConversationSnapshot } from "./protocol";

/** Objective Chat `space_uuid` prefix (architecture §4.2). */
export const SPACE_UUID_PREFIX = "space:";

/** Legacy subjective conversation id prefix (same member-set hash, different prefix). */
export const PSLACK_CONVERSATION_PREFIX = "c:";

/**
 * Map objective Space id to legacy group-chat conversation id for interim websocket frames.
 * Both derive from the same canonical member-set hash; only the prefix differs.
 */
export function pslackConversationIdFromSpaceUuid(spaceUuid: string): string {
    if (spaceUuid.startsWith(SPACE_UUID_PREFIX)) {
        return `${PSLACK_CONVERSATION_PREFIX}${spaceUuid.slice(SPACE_UUID_PREFIX.length)}`;
    }
    if (spaceUuid.startsWith(PSLACK_CONVERSATION_PREFIX)) {
        return spaceUuid;
    }
    return spaceUuid;
}

export function spaceUuidFromPslackConversationId(
    conversationId: string,
): string {
    if (conversationId.startsWith(PSLACK_CONVERSATION_PREFIX)) {
        return `${SPACE_UUID_PREFIX}${conversationId.slice(PSLACK_CONVERSATION_PREFIX.length)}`;
    }
    if (conversationId.startsWith(SPACE_UUID_PREFIX)) {
        return conversationId;
    }
    return conversationId;
}

export type GraphqlSpaceEntry = {
    space_uuid: string;
    members: string[];
    kind: "DM" | "GROUP";
};

export function spaceEntryToConversation(
    entry: GraphqlSpaceEntry,
): ConversationSnapshot {
    return {
        conversationId: entry.space_uuid,
        kind: entry.kind === "DM" ? "dm" : "group",
        members: entry.members,
    };
}
