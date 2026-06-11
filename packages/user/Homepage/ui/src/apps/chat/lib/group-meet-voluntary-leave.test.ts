import { describe, expect, it } from "vitest";

import {
    consumeVoluntaryGroupMeetLeave,
    markVoluntaryGroupMeetLeave,
    peekVoluntaryGroupMeetLeave,
} from "./group-meet-voluntary-leave";

describe("group-meet-voluntary-leave", () => {
    it("allows leave only for marked account once", () => {
        markVoluntaryGroupMeetLeave("carol");
        expect(peekVoluntaryGroupMeetLeave("carol")).toBe(true);
        expect(consumeVoluntaryGroupMeetLeave("carol")).toBe(true);
        expect(peekVoluntaryGroupMeetLeave("carol")).toBe(false);
        expect(consumeVoluntaryGroupMeetLeave("carol")).toBe(false);
        expect(consumeVoluntaryGroupMeetLeave("alice")).toBe(false);
    });
});
