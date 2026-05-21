import type { AvCallIncomingInvite } from "./av-call-session-types";
import type { ChatObjectiveCallEvent } from "./call-timeline-bridge";
import type { ChatSessionEntry } from "./chat-api";
import { conversationVisibleToUser } from "./contacts-policy";
import {
    resolveVisibleConversation,
    shouldAcceptAvCallInvite,
} from "./dm-contacts-meet-flow";
import type { ConversationSnapshot } from "./protocol";
import {
    spaceEntryToConversation,
    type GraphqlSpaceEntry,
} from "./space-bridge";

export function memberCanonicalKey(members: readonly string[]): string {
    return [...members].sort().join("|");
}

/** Find an existing group Space with the given member set (Contacts-visible). */
export function findVisibleGroupWithMembers(
    members: readonly string[],
    self: string,
    spaces: readonly GraphqlSpaceEntry[],
    contactAccounts: ReadonlySet<string>,
    contactsLoaded: boolean,
): ConversationSnapshot | undefined {
    const key = memberCanonicalKey(members);
    for (const entry of spaces) {
        if (entry.kind !== "GROUP") continue;
        if (memberCanonicalKey(entry.members) !== key) continue;
        const conv = spaceEntryToConversation(entry);
        if (
            conv.kind !== "group" ||
            conv.members.length <= 2 ||
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

/** Contacts policy gate for inbound group av-call sessionInvite (architecture §7). */
export function shouldAcceptGroupAvCallInvite(
    invite: Pick<AvCallIncomingInvite, "from" | "participants">,
    self: string,
    acceptInboundFrom: (account: string) => boolean,
    contactAccounts: ReadonlySet<string>,
    contactsLoaded: boolean,
): boolean {
    if (!shouldAcceptAvCallInvite(invite.from, acceptInboundFrom)) {
        return false;
    }
    if (!contactsLoaded) return true;
    const remotes = (invite.participants ?? []).filter((member) => member !== self);
    return remotes.every((member) => contactAccounts.has(member));
}

export function inferGroupCallInviter(
    events: readonly ChatObjectiveCallEvent[],
    sessionId: string,
    fallback: string,
): string {
    const started = events.find(
        (row) => row.sessionId === sessionId && row.event === "started",
    );
    return started?.actor ?? fallback;
}

export function shouldDiscoverActiveGroupAvCall(
    spaceUuid: string,
    self: string,
    members: readonly string[],
    options: {
        activeCallConversationId?: string;
        pendingInviteSpaceUuid?: string;
        hasLocalRun?: boolean;
        contactsLoaded: boolean;
        contactAccounts: ReadonlySet<string>;
    },
): boolean {
    if (members.length <= 2 || !members.includes(self)) return false;
    if (options.activeCallConversationId === spaceUuid) return false;
    if (options.pendingInviteSpaceUuid === spaceUuid) return false;
    if (options.hasLocalRun) return false;
    const conv = resolveVisibleConversation(
        spaceUuid,
        self,
        [{ space_uuid: spaceUuid, members: [...members], kind: "GROUP" }],
        options.contactAccounts,
        options.contactsLoaded,
    );
    return conv?.kind === "group";
}

export function buildGroupAvCallInviteFromActiveSession(
    session: ChatSessionEntry,
    inviter: string,
): AvCallIncomingInvite {
    return {
        sessionId: session.session_id,
        spaceUuid: session.space_uuid,
        from: inviter,
        wantVideo: true,
        wantAudio: true,
        participants: [...session.participants],
    };
}
