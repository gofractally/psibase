import { describe, expect, it } from "vitest";

import {
    shouldApplySpaceFromUrl,
    shouldPushSelectionToUrl,
} from "./use-chat-url-space-sync";

describe("useChatUrlSpaceSync helpers", () => {
    it("applies url-space only when not composing pending DM", () => {
        expect(shouldApplySpaceFromUrl("space:GROUP", null)).toBe(true);
        expect(shouldApplySpaceFromUrl("space:GROUP", "bob")).toBe(false);
        expect(shouldApplySpaceFromUrl("space:GROUP", null, "bob")).toBe(false);
        expect(shouldApplySpaceFromUrl(undefined, null)).toBe(false);
    });

    it("pushes selection when url diverges and compose-first is inactive", () => {
        expect(
            shouldPushSelectionToUrl("space:DM", null, "space:GROUP"),
        ).toBe(true);
        expect(
            shouldPushSelectionToUrl("space:DM", null, "space:DM"),
        ).toBe(false);
        expect(
            shouldPushSelectionToUrl("space:GROUP", "bob", "space:GROUP"),
        ).toBe(false);
        expect(shouldPushSelectionToUrl(undefined, null, "space:GROUP")).toBe(
            false,
        );
    });
});
