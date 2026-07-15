import { describe, expect, it } from "vitest";

import {
    findVisibleDmWithPeer,
    needsSpaceReloadForAvCallInvite,
    resolveVisibleConversation,
    shouldAcceptAvCallInvite,
} from "./dm-contacts-meet-flow";
import type { GraphqlSpaceEntry } from "./space-bridge";

const SELF = "alice";
const BOB = "bob";
const STRANGER = "stranger";

const contacts = new Set([BOB]);

const dmSpace: GraphqlSpaceEntry = {
    space_uuid: "space-dm-1",
    members: [SELF, BOB],
    kind: "DM",
};

describe("dm-contacts-meet-flow", () => {
    it("accepts av-call invites from Contacts only", () => {
        const accept = (account: string) => contacts.has(account);
        expect(shouldAcceptAvCallInvite(BOB, accept)).toBe(true);
        expect(shouldAcceptAvCallInvite(STRANGER, accept)).toBe(false);
    });

    it("resolves visible DM conversation by space uuid", () => {
        const conv = resolveVisibleConversation(
            dmSpace.space_uuid,
            SELF,
            [dmSpace],
            contacts,
            true,
        );
        expect(conv?.kind).toBe("dm");
        expect(conv?.members).toEqual([SELF, BOB]);
    });

    it("finds DM with peer from objective spaces", () => {
        const conv = findVisibleDmWithPeer(
            BOB,
            SELF,
            [dmSpace],
            contacts,
            true,
        );
        expect(conv?.conversationId).toBe("space-dm-1");
    });

    it("flags space reload when invite space is not loaded yet", () => {
        expect(
            needsSpaceReloadForAvCallInvite(
                dmSpace.space_uuid,
                SELF,
                [],
                contacts,
                true,
            ),
        ).toBe(true);
        expect(
            needsSpaceReloadForAvCallInvite(
                dmSpace.space_uuid,
                SELF,
                [dmSpace],
                contacts,
                true,
            ),
        ).toBe(false);
    });
});
