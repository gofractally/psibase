import { describe, expect, it } from "vitest";

import type { ChatObjectiveCallEvent } from "./call-timeline-bridge";
import type { ChatSessionEntry } from "./chat-api";
import {
    buildGroupAvCallInviteFromActiveSession,
    findVisibleGroupWithMembers,
    inferGroupCallInviter,
    memberCanonicalKey,
    shouldAcceptGroupAvCallInvite,
    shouldDiscoverActiveGroupAvCall,
} from "./group-contacts-meet-flow";
import type { GraphqlSpaceEntry } from "./space-bridge";

const SELF = "alice";
const BOB = "bob";
const CAROL = "carol";
const STRANGER = "stranger";

const contacts = new Set([BOB, CAROL]);

const groupSpace: GraphqlSpaceEntry = {
    space_uuid: "space-group-1",
    members: [SELF, BOB, CAROL],
    kind: "GROUP",
};

const activeSession: ChatSessionEntry = {
    session_id: "sess-1",
    space_uuid: groupSpace.space_uuid,
    purpose: "av-call",
    participants: groupSpace.members,
    lifecycle: 1,
    expires_at: Date.now() + 60_000,
    created_at: Date.now(),
};

describe("group-contacts-meet-flow", () => {
    it("accepts group av-call invites when inviter and all remotes are Contacts", () => {
        const accept = (account: string) => contacts.has(account);
        expect(
            shouldAcceptGroupAvCallInvite(
                {
                    from: BOB,
                    participants: [SELF, BOB, CAROL],
                },
                SELF,
                accept,
                contacts,
                true,
            ),
        ).toBe(true);
        expect(
            shouldAcceptGroupAvCallInvite(
                {
                    from: STRANGER,
                    participants: [SELF, BOB, CAROL],
                },
                SELF,
                accept,
                contacts,
                true,
            ),
        ).toBe(false);
        expect(
            shouldAcceptGroupAvCallInvite(
                {
                    from: BOB,
                    participants: [SELF, BOB, STRANGER],
                },
                SELF,
                accept,
                contacts,
                true,
            ),
        ).toBe(false);
    });

    it("finds visible group by canonical member key", () => {
        const conv = findVisibleGroupWithMembers(
            [SELF, CAROL, BOB],
            SELF,
            [groupSpace],
            contacts,
            true,
        );
        expect(conv?.conversationId).toBe("space-group-1");
        expect(memberCanonicalKey(conv!.members)).toBe(
            memberCanonicalKey(groupSpace.members),
        );
    });

    it("infers inviter from started call event", () => {
        const events: ChatObjectiveCallEvent[] = [
            {
                sessionId: activeSession.session_id,
                spaceUuid: groupSpace.space_uuid,
                event: "started",
                actor: BOB,
                at: 1,
            },
        ];
        expect(
            inferGroupCallInviter(events, activeSession.session_id, CAROL),
        ).toBe(BOB);
    });

    it("builds pending invite from active objective session", () => {
        const invite = buildGroupAvCallInviteFromActiveSession(
            activeSession,
            BOB,
        );
        expect(invite.sessionId).toBe("sess-1");
        expect(invite.spaceUuid).toBe(groupSpace.space_uuid);
        expect(invite.from).toBe(BOB);
        expect(invite.participants).toEqual(groupSpace.members);
    });

    it("discovers active group call only when not already in call", () => {
        expect(
            shouldDiscoverActiveGroupAvCall(
                groupSpace.space_uuid,
                SELF,
                groupSpace.members,
                {
                    contactsLoaded: true,
                    contactAccounts: contacts,
                },
            ),
        ).toBe(true);
        expect(
            shouldDiscoverActiveGroupAvCall(
                groupSpace.space_uuid,
                SELF,
                groupSpace.members,
                {
                    activeCallConversationId: groupSpace.space_uuid,
                    contactsLoaded: true,
                    contactAccounts: contacts,
                },
            ),
        ).toBe(false);
    });
});
