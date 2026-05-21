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

/** Canonical member order matches objective Chat (sort by account string). */
export function canonicalSpaceMembers(
    members: readonly string[],
): string[] {
    return [...new Set(members)].sort((a, b) => a.localeCompare(b));
}

/**
 * Deterministic objective space id — mirrors Chat service
 * `space_uuid_for_members` (JSON canonical member list → sha256 hex).
 */
export async function deriveSpaceUuidForCanonicalMembers(
    members: readonly string[],
): Promise<string> {
    const canonical = canonicalSpaceMembers(members);
    const bytes = new TextEncoder().encode(JSON.stringify(canonical));
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const hex = [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
    return `${SPACE_UUID_PREFIX}${hex}`;
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
