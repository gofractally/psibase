import { describe, expect, it } from "vitest";

import {
    expectedDmSpaceId,
    expectedDmSpaceIds,
    isDmSelectionForPeer,
    isExpectedDmSpaceId,
    isSameSpaceId,
    type ChatSelectionState,
} from "./chat-ui";

// Real values from churn iter8 (seed 0xdecafbad): the chain sorted the
// bob↔carol pair by AccountNumber value — the reverse of localeCompare order.
const BOB = "aayiiojklb";
const CAROL = "aceeqnvmbi";
const CHAIN_ID =
    "space:9D231F92EE8FD017CA5CC2CEF6B04E41B363B15182249323495F552AF35819B5";
const LEXICOGRAPHIC_ID =
    "space:87eb33ac1e91f28775082e09652ac426913c90c9a2c09257f8d93e869b100a00";

function selection(
    overrides: Partial<ChatSelectionState>,
): ChatSelectionState {
    return {
        selectedConversationId: null,
        composePendingDmPeer: null,
        pendingDmMember: null,
        selectedConversationKind: null,
        urlSpaceId: null,
        threadHeader: null,
        selfAccount: CAROL,
        threadRemoteRecipients: [],
        ...overrides,
    };
}

describe("expectedDmSpaceIds", () => {
    it("covers both member orderings (chain AccountNumber sort ≠ localeCompare)", () => {
        const ids = expectedDmSpaceIds(CAROL, BOB);
        expect(ids).toHaveLength(2);
        expect(ids.some((id) => isSameSpaceId(id, CHAIN_ID))).toBe(true);
        expect(ids.some((id) => isSameSpaceId(id, LEXICOGRAPHIC_ID))).toBe(
            true,
        );
    });

    it("single lexicographic id misses the iter8 chain id (regression guard)", () => {
        expect(
            isSameSpaceId(expectedDmSpaceId(CAROL, BOB), CHAIN_ID),
        ).toBe(false);
    });

    it("isExpectedDmSpaceId matches the chain id case-insensitively", () => {
        expect(isExpectedDmSpaceId(CHAIN_ID, CAROL, BOB)).toBe(true);
        expect(isExpectedDmSpaceId(CHAIN_ID, BOB, CAROL)).toBe(true);
        expect(isExpectedDmSpaceId("space:0000", CAROL, BOB)).toBe(false);
    });
});

describe("isDmSelectionForPeer", () => {
    it("accepts the iter8 fail-state via threadRemoteRecipients", () => {
        const state = selection({
            selectedConversationId: CHAIN_ID,
            selectedConversationKind: "dm",
            threadRemoteRecipients: [BOB],
        });
        expect(isDmSelectionForPeer(state, BOB)).toBe(true);
    });

    it("accepts the chain space id even without recipients/header", () => {
        const state = selection({
            selectedConversationId: CHAIN_ID,
            selectedConversationKind: "dm",
        });
        expect(isDmSelectionForPeer(state, BOB)).toBe(true);
    });

    it("rejects a different DM peer", () => {
        const state = selection({
            selectedConversationId: CHAIN_ID,
            selectedConversationKind: "dm",
            threadRemoteRecipients: ["aaameampww"],
        });
        expect(isDmSelectionForPeer(state, BOB)).toBe(false);
    });

    it("rejects group selections regardless of recipients", () => {
        const state = selection({
            selectedConversationId: CHAIN_ID,
            selectedConversationKind: "group",
            threadRemoteRecipients: [BOB],
        });
        expect(isDmSelectionForPeer(state, BOB)).toBe(false);
    });

    it("accepts compose-first pending peer before a space exists", () => {
        const state = selection({ composePendingDmPeer: BOB });
        expect(isDmSelectionForPeer(state, BOB)).toBe(true);
    });
});
