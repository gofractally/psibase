import { describe, expect, it } from "vitest";

import type { ConversationSnapshot } from "./protocol";
import {
    dmMembersForPendingPeer,
    findDmConversationWithPeer,
    resolveComposeSurfaceConversationId,
    shouldQueueFirstDmUntilSpace,
} from "./dm-first-message-send";

describe("shouldQueueFirstDmUntilSpace", () => {
    it("queues when composer has pending peer but no space yet", () => {
        expect(shouldQueueFirstDmUntilSpace(undefined, "alicealice")).toBe(
            true,
        );
    });

    it("does not queue when space is selected", () => {
        expect(
            shouldQueueFirstDmUntilSpace("space:abc", "alicealice"),
        ).toBe(false);
    });

    it("does not queue without pending peer", () => {
        expect(shouldQueueFirstDmUntilSpace(undefined, null)).toBe(false);
    });
});

describe("findDmConversationWithPeer", () => {
    const conversations: ConversationSnapshot[] = [
        {
            conversationId: "space:dm-1",
            kind: "dm",
            members: ["myprod", "alicealice"],
        },
        {
            conversationId: "space:group-1",
            kind: "group",
            members: ["myprod", "alicealice", "daviddavid"],
        },
    ];

    it("finds a two-person DM with the peer", () => {
        expect(
            findDmConversationWithPeer(conversations, "myprod", "alicealice")
                ?.conversationId,
        ).toBe("space:dm-1");
    });

    it("returns undefined when no matching DM exists", () => {
        expect(
            findDmConversationWithPeer(conversations, "myprod", "carolcarol"),
        ).toBeUndefined();
    });
});

describe("dmMembersForPendingPeer", () => {
    it("returns canonical sorted members", () => {
        expect(dmMembersForPendingPeer("myprod", "alicealice")).toEqual([
            "alicealice",
            "myprod",
        ]);
    });
});

describe("resolveComposeSurfaceConversationId", () => {
    const conversations: ConversationSnapshot[] = [
        {
            conversationId: "space:dm-1",
            kind: "dm",
            members: ["myprod", "alicealice"],
        },
    ];

    it("prefers an explicit selection", () => {
        expect(
            resolveComposeSurfaceConversationId(
                "space:other",
                "alicealice",
                "myprod",
                conversations,
            ),
        ).toBe("space:other");
    });

    it("resolves pending peer to an objective DM space", () => {
        expect(
            resolveComposeSurfaceConversationId(
                undefined,
                "alicealice",
                "myprod",
                conversations,
            ),
        ).toBe("space:dm-1");
    });

    it("returns undefined when pending peer has no space yet", () => {
        expect(
            resolveComposeSurfaceConversationId(
                undefined,
                "carolcarol",
                "myprod",
                conversations,
            ),
        ).toBeUndefined();
    });
});
