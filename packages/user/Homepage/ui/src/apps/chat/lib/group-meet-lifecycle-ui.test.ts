import { describe, expect, it } from "vitest";

import {
    beginGroupMeetLeave,
    clearGroupMeetLifecycle,
    completeGroupMeetLeave,
    isGroupMeetLeaveInProgress,
    markGroupMeetActive,
    rejoinHintFromLifecycle,
    shouldBlockGroupMeetRearm,
} from "./group-meet-lifecycle-ui";

const SPACE = "space-uuid-1";

describe("group-meet-lifecycle-ui", () => {
    it("blocks re-arm only while leaving, not after left-rejoinable", () => {
        let map = markGroupMeetActive({}, SPACE);
        expect(shouldBlockGroupMeetRearm(map, SPACE)).toBe(false);

        map = beginGroupMeetLeave(map, SPACE, 1_000);
        expect(shouldBlockGroupMeetRearm(map, SPACE, 2_000)).toBe(true);

        map = completeGroupMeetLeave(map, SPACE, {
            spaceUuid: SPACE,
            sessionId: "sess-1",
            joinedCount: 2,
        }, 2_000);
        expect(shouldBlockGroupMeetRearm(map, SPACE, 3_000)).toBe(false);
        expect(rejoinHintFromLifecycle(map, SPACE)).toEqual({
            spaceUuid: SPACE,
            sessionId: "sess-1",
            joinedCount: 2,
        });
    });

    it("clears lifecycle on explicit rejoin", () => {
        const map = completeGroupMeetLeave(
            beginGroupMeetLeave({}, SPACE),
            SPACE,
            { spaceUuid: SPACE, sessionId: "sess-1", joinedCount: 1 },
        );
        const cleared = clearGroupMeetLifecycle(map, SPACE);
        expect(shouldBlockGroupMeetRearm(cleared, SPACE)).toBe(false);
        expect(rejoinHintFromLifecycle(cleared, SPACE)).toBeNull();
    });

    it("does not block re-arm after full leave without survivors", () => {
        const map = completeGroupMeetLeave(
            beginGroupMeetLeave({}, SPACE),
            SPACE,
            null,
        );
        expect(shouldBlockGroupMeetRearm(map, SPACE)).toBe(false);
        expect(rejoinHintFromLifecycle(map, SPACE)).toBeNull();
    });

    it("does not block unrelated spaces", () => {
        const map = beginGroupMeetLeave({}, SPACE);
        expect(shouldBlockGroupMeetRearm(map, "other-space")).toBe(false);
    });

    it("isGroupMeetLeaveInProgress only during leaving phase", () => {
        let map = beginGroupMeetLeave({}, SPACE, 1_000);
        expect(isGroupMeetLeaveInProgress(map, SPACE)).toBe(true);

        map = completeGroupMeetLeave(map, SPACE, null, 2_000);
        expect(isGroupMeetLeaveInProgress(map, SPACE)).toBe(false);
        expect(shouldBlockGroupMeetRearm(map, SPACE, 3_000)).toBe(false);
    });
});
