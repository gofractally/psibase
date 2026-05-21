import type { ConversationSnapshot } from "./protocol";

/** First send from Contacts before ensureDm returns a space uuid. */
export function shouldQueueFirstDmUntilSpace(
    conversationId: string | undefined,
    pendingPeerAccount: string | null | undefined,
): boolean {
    return !conversationId && !!pendingPeerAccount;
}

export function findDmConversationWithPeer(
    conversations: readonly ConversationSnapshot[],
    self: string,
    peerAccount: string,
): ConversationSnapshot | undefined {
    return conversations.find(
        (row) =>
            row.kind === "dm" &&
            row.members.length === 2 &&
            row.members.includes(peerAccount) &&
            row.members.includes(self),
    );
}

/** Timeline + unread target while compose-first DM is opening (Contacts → pending peer). */
export function resolveComposeSurfaceConversationId(
    selectedConversationId: string | undefined,
    composePendingDmPeer: string | null,
    self: string | null,
    conversations: readonly ConversationSnapshot[],
): string | undefined {
    if (selectedConversationId) return selectedConversationId;
    if (!composePendingDmPeer || !self) return undefined;
    return findDmConversationWithPeer(
        conversations,
        self,
        composePendingDmPeer,
    )?.conversationId;
}

/** Members for a DM pending row when objective Spaces are not loaded yet. */
export function dmMembersForPendingPeer(
    self: string,
    pendingPeer: string,
): [string, string] {
    return self.localeCompare(pendingPeer) < 0
        ? [self, pendingPeer]
        : [pendingPeer, self];
}
