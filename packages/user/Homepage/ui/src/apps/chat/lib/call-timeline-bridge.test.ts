import { describe, expect, it } from "vitest";

import {
    mergeObjectiveCallEventsIntoTimeline,
    objectiveCallEventToTimelineRow,
} from "./call-timeline-bridge";

describe("call-timeline-bridge", () => {
    it("maps objective events to timeline rows with obj- keys", () => {
        const row = objectiveCallEventToTimelineRow({
            sessionId: "wrtc:abc",
            spaceUuid: "space:1",
            event: "started",
            actor: "alice",
            at: 42,
        });
        expect(row.key).toBe("obj-wrtc:abc-42-started");
        expect(row.event).toBe("started");
        expect(row.callId).toBe("wrtc:abc");
    });

    it("merges objective events without duplicating keys", () => {
        const existing = [
            objectiveCallEventToTimelineRow({
                sessionId: "wrtc:1",
                spaceUuid: "space:1",
                event: "started",
                actor: "alice",
                at: 1,
            }),
        ];
        const merged = mergeObjectiveCallEventsIntoTimeline(existing, [
            {
                sessionId: "wrtc:1",
                spaceUuid: "space:1",
                event: "started",
                actor: "alice",
                at: 1,
            },
            {
                sessionId: "wrtc:1",
                spaceUuid: "space:1",
                event: "ended",
                actor: "alice",
                at: 2,
            },
        ]);
        expect(merged).toHaveLength(2);
        expect(merged.map((row) => row.event)).toEqual(["started", "ended"]);
    });
});
