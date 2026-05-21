import { conversationVisibleToUser } from "./contacts-policy";
import type { ConversationSnapshot } from "./protocol";
import {
    spaceEntryToConversation,
    type GraphqlSpaceEntry,
} from "./space-bridge";

/** Resolve a visible conversation row from objective spaces (sync, ref-safe). */
export function resolveVisibleConversation(
    spaceUuid: string,
    self: string,
    spaces: readonly GraphqlSpaceEntry[],
    contactAccounts: ReadonlySet<string>,
    contactsLoaded: boolean,
): ConversationSnapshot | undefined {
    const entry = spaces.find((row) => row.space_uuid === spaceUuid);
    if (!entry) return undefined;
    const conv = spaceEntryToConversation(entry);
    if (
        !conversationVisibleToUser(
            conv,
            self,
            contactAccounts,
            contactsLoaded,
        )
    ) {
        return undefined;
    }
    return conv;
}

/** Find an existing two-person DM Space with a Contacts peer. */
export function findVisibleDmWithPeer(
    peerAccount: string,
    self: string,
    spaces: readonly GraphqlSpaceEntry[],
    contactAccounts: ReadonlySet<string>,
    contactsLoaded: boolean,
): ConversationSnapshot | undefined {
    for (const entry of spaces) {
        if (entry.kind !== "DM") continue;
        const conv = spaceEntryToConversation(entry);
        if (
            conv.kind !== "dm" ||
            conv.members.length !== 2 ||
            !conv.members.includes(peerAccount) ||
            !conv.members.includes(self)
        ) {
            continue;
        }
        if (
            !conversationVisibleToUser(
                conv,
                self,
                contactAccounts,
                contactsLoaded,
            )
        ) {
            continue;
        }
        return conv;
    }
    return undefined;
}

/** Contacts policy gate for inbound av-call sessionInvite (architecture §7). */
export function shouldAcceptAvCallInvite(
    from: string,
    acceptInboundFrom: (account: string) => boolean,
): boolean {
    return acceptInboundFrom(from);
}

/** Whether objective spaces need refresh before handling an av-call invite. */
export function needsSpaceReloadForAvCallInvite(
    spaceUuid: string,
    self: string,
    spaces: readonly GraphqlSpaceEntry[],
    contactAccounts: ReadonlySet<string>,
    contactsLoaded: boolean,
): boolean {
    return (
        resolveVisibleConversation(
            spaceUuid,
            self,
            spaces,
            contactAccounts,
            contactsLoaded,
        ) === undefined
    );
}
