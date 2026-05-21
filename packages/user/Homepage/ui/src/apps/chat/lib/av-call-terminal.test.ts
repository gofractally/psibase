import { describe, expect, it } from "vitest";

import {
    avCallTerminalUiMessage,
    isAvCallTerminalReason,
    normalizeAvCallTerminalReason,
} from "./av-call-terminal";

describe("av-call terminal semantics", () => {
    it("normalizes invite-timeout to timeout for objective timeline", () => {
        expect(normalizeAvCallTerminalReason("invite-timeout")).toBe("timeout");
        expect(normalizeAvCallTerminalReason("declined")).toBe("declined");
    });

    it("detects terminal decline/missed reasons", () => {
        expect(isAvCallTerminalReason("declined")).toBe(true);
        expect(isAvCallTerminalReason("invite-timeout")).toBe(true);
        expect(isAvCallTerminalReason("cancelled")).toBe(true);
        expect(isAvCallTerminalReason("transport")).toBe(false);
    });

    it("maps terminal reasons to caller UI copy", () => {
        expect(avCallTerminalUiMessage("declined")).toBe("Call declined");
        expect(avCallTerminalUiMessage("invite-timeout")).toBe("No answer");
        expect(avCallTerminalUiMessage("timeout")).toBe("No answer");
        expect(avCallTerminalUiMessage("cancelled")).toBe("Call cancelled");
    });
});
