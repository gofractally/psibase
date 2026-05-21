import { describe, expect, it } from "vitest";

import {
    anyGroupMeetJoined,
    buildGroupMeetParticipants,
    buildGroupMeetRemoteStreamMap,
    groupMeetDisplayPeer,
    groupMeetStatusLabel,
} from "./group-meet-ui-state";

const SELF = "alice";
const BOB = "bob";
const CAROL = "carol";
const DAVE = "dave";

describe("group-meet-ui-state", () => {
    it("marks mesh-ready peers joined and offline peers offline", () => {
        const participants = buildGroupMeetParticipants(
            [SELF, BOB, CAROL, DAVE],
            SELF,
            { [BOB]: "online", [CAROL]: "offline", [DAVE]: "online" },
            { [BOB]: true },
            "ready",
        );
        expect(participants).toEqual([
            { account: BOB, status: "joined" },
            { account: CAROL, status: "offline" },
            { account: DAVE, status: "ringing" },
        ]);
    });

    it("supports partial join when only subset online", () => {
        const participants = buildGroupMeetParticipants(
            [SELF, BOB, CAROL],
            SELF,
            { [BOB]: "online", [CAROL]: "offline" },
            {},
            "waiting-peer",
        );
        expect(participants).toEqual([
            { account: BOB, status: "ringing" },
            { account: CAROL, status: "offline" },
        ]);
        expect(groupMeetStatusLabel(participants, "waiting-peer", false)).toBe(
            "Ringing members…",
        );
    });

    it("formats display peer and connected roster summary", () => {
        const participants = buildGroupMeetParticipants(
            [SELF, BOB, CAROL],
            SELF,
            { [BOB]: "online", [CAROL]: "online" },
            { [BOB]: true },
            "ready",
        );
        expect(groupMeetDisplayPeer(participants)).toBe(BOB);
        expect(
            groupMeetStatusLabel(participants, "ready", true),
        ).toBe("1 joined · 1 ringing");
        expect(anyGroupMeetJoined({ [BOB]: true })).toBe(true);
    });

    it("builds per-peer remote stream map from mesh peers", () => {
        const bobStream = { id: "bob-stream" } as MediaStream;
        const peers = new Map([
            [BOB, { getRemoteStream: () => bobStream }],
            [CAROL, { getRemoteStream: () => null }],
        ]);
        expect(buildGroupMeetRemoteStreamMap(peers)).toEqual({
            [BOB]: bobStream,
            [CAROL]: null,
        });
        expect(buildGroupMeetRemoteStreamMap(new Map())).toEqual({});
    });
});
