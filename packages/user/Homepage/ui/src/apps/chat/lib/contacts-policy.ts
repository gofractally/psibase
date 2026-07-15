import type { ConversationSnapshot } from "./protocol";

/** True when `account` is the signed-in user or in the local Contacts list. */
export function isInboundContactPeer(
    self: string | null | undefined,
    account: string,
    contactAccounts: ReadonlySet<string>,
    contactsLoaded: boolean,
): boolean {
    if (!self) return false;
    if (account === self) return true;
    if (!contactsLoaded) return false;
    return contactAccounts.has(account);
}

/**
 * Whether a Space/conversation should appear in Chat UI for this user.
 * DM: other member must be a Contact. Group: every other member must be a Contact.
 */
export function conversationVisibleToUser(
    conv: ConversationSnapshot,
    self: string,
    contactAccounts: ReadonlySet<string>,
    contactsLoaded: boolean,
): boolean {
    if (!contactsLoaded) return true;

    const others = conv.members.filter((m) => m !== self);
    if (others.length === 0) return false;

    return others.every((member) => contactAccounts.has(member));
}
