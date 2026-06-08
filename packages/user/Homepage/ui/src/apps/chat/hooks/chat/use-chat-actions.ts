import { ensureDm, ensureGroup } from "../../lib/chat-api";
import {
    dmMembersForPendingPeer,
    findDmConversationWithPeer,
    shouldQueueFirstDmUntilSpace,
} from "../../lib/dm-first-message-send";
import type { ConversationSnapshot } from "../../lib/protocol";

export type SendChatMessageInput = {
    body: string;
    convId: string | undefined;
    from: string;
    pendingPeer: string | null;
    conversation: ConversationSnapshot | undefined;
};

export type SendChatMessagePlan =
    | { kind: "noop" }
    | { kind: "queue-first-dm"; peerAccount: string; body: string }
    | {
          kind: "enqueue";
          convId: string;
          trimmed: string;
          recipients: string[];
          dmMembers: [string, string] | null;
          conversation: ConversationSnapshot | undefined;
      };

/** Pure send routing — queue vs enqueue vs noop. */
export function planSendChatMessage(
    input: SendChatMessageInput,
): SendChatMessagePlan {
    const { body, convId, from, pendingPeer, conversation } = input;
    if ((!convId && !pendingPeer) || !from) return { kind: "noop" };

    const trimmed = body.trim();
    if (!trimmed) return { kind: "noop" };

    let recipients: string[] = [];
    let dmMembers: [string, string] | null = null;

    if (conversation?.kind === "dm" && conversation.members.length === 2) {
        dmMembers = [conversation.members[0], conversation.members[1]];
        recipients = conversation.members.filter((member) => member !== from);
    } else if (pendingPeer) {
        dmMembers = dmMembersForPendingPeer(from, pendingPeer);
        if (dmMembers) recipients = [pendingPeer];
    } else if (conversation) {
        recipients = conversation.members.filter((member) => member !== from);
    } else {
        return { kind: "noop" };
    }

    if (
        shouldQueueFirstDmUntilSpace(convId, pendingPeer, conversation?.kind) &&
        dmMembers
    ) {
        return {
            kind: "queue-first-dm",
            peerAccount: pendingPeer!,
            body: trimmed,
        };
    }

    if (!convId) return { kind: "noop" };

    return {
        kind: "enqueue",
        convId,
        trimmed,
        recipients,
        dmMembers,
        conversation,
    };
}

export async function ensureDmSpace(peerAccount: string): Promise<void> {
    await ensureDm(peerAccount);
}

export async function ensureGroupSpace(
    otherAccounts: string[],
): Promise<void> {
    await ensureGroup(otherAccounts);
}

export { findDmConversationWithPeer };
