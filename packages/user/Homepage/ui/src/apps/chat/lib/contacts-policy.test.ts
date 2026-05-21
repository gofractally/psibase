import { describe, expect, it } from "vitest";

import { conversationVisibleToUser } from "./contacts-policy";
import type { ConversationSnapshot } from "./protocol";

const SELF = "alice";
const BOB = "bob";
const CAROL = "carol";

describe("conversationVisibleToUser", () => {
    const group: ConversationSnapshot = {
        conversationId: "space:group-1",
        kind: "group",
        members: [SELF, BOB, CAROL],
    };

    it("shows a group when every other member is a contact", () => {
        expect(
            conversationVisibleToUser(
                group,
                SELF,
                new Set([BOB, CAROL]),
                true,
            ),
        ).toBe(true);
    });

    it("hides a group when only the creator is a contact (partial graph)", () => {
        expect(
            conversationVisibleToUser(group, SELF, new Set([BOB]), true),
        ).toBe(false);
    });
});
