import { describe, expect, it } from "vitest";

import {
    mergeRosterIntoRun,
    shouldApplyStaleSessionSnapshot,
} from "./chat-data-realtime-handlers";
import { shouldInitiateOffer } from "./chat-data-session-types";
import type { GroupSpaceRun } from "./chat-data-session-types";

function emptyGroupRun(): GroupSpaceRun {
    return {
        kind: "group",
        spaceUuid: "space:g",
        members: ["e2ealicegc", "daviddavid", "e2ecarolgc"],
        meshPeers: new Map(),
        peerOnlineAtSessionStart: new Map(),
        peerHadOpenDataChannel: new Map(),
        abort: new AbortController(),
        transportRecoveryAttempt: 0,
        snapshot: {
            spaceUuid: "space:g",
            phase: "signaling",
            sessionId: "wrtc:g",
            dataChannelReady: false,
        },
        hasJoined: false,
        joinSessionRequested: false,
        joinedWelcomeGeneration: 0,
        sessionRoster: new Map(),
        sessionSnapshotEpoch: 0,
        transportLostAt: new Map(),
        lastMeshNudgeMs: 0,
        onUpdate: () => {},
    };
}

describe("mergeRosterIntoRun — monotonic joinedAt", () => {
    it("late joiner in a later snapshot gets joinedAt after existing entries", () => {
        const run = emptyGroupRun();
        const alice = "e2ealicegc";
        const bob = "daviddavid";
        const carol = "e2ecarolgc";

        // Inviter already in roster from sessionInvite.
        run.sessionRoster.set(alice, { account: alice, joinedAt: 100 });

        mergeRosterIntoRun(run, [alice, bob], []);
        expect(run.sessionRoster.get(bob)?.joinedAt).toBeGreaterThan(100);

        const bobJoinedAt = run.sessionRoster.get(bob)!.joinedAt;
        mergeRosterIntoRun(run, [alice, bob, carol], []);

        expect(run.sessionRoster.get(carol)?.joinedAt).toBeGreaterThan(
            bobJoinedAt,
        );
        expect(
            shouldInitiateOffer(carol, alice, run.sessionRoster),
        ).toBe(true);
        expect(shouldInitiateOffer(carol, bob, run.sessionRoster)).toBe(true);
        expect(shouldInitiateOffer(bob, carol, run.sessionRoster)).toBe(false);
    });

    it("self is last among newcomers in a full-roster snapshot regardless of server order", () => {
        const run = emptyGroupRun();
        const alice = "occalicegc";
        const bob = "occbobbbgc";
        const carol = "occcarolgc";

        mergeRosterIntoRun(run, [carol, alice, bob], [], carol);

        const carolJoinedAt = run.sessionRoster.get(carol)!.joinedAt;
        expect(carolJoinedAt).toBeGreaterThan(
            run.sessionRoster.get(alice)!.joinedAt,
        );
        expect(carolJoinedAt).toBeGreaterThan(
            run.sessionRoster.get(bob)!.joinedAt,
        );
        expect(
            shouldInitiateOffer(carol, alice, run.sessionRoster),
        ).toBe(true);
        expect(shouldInitiateOffer(carol, bob, run.sessionRoster)).toBe(true);
    });
});

describe("shouldApplyStaleSessionSnapshot", () => {
    it("accepts lower epoch when a pending account recently had transportLost", () => {
        const run = emptyGroupRun();
        run.sessionSnapshotEpoch = 3;
        run.transportLostAt.set("churnbobbb", Date.now());
        expect(
            shouldApplyStaleSessionSnapshot(run, {
                t: "sessionSnapshot",
                sessionId: "wrtc:g",
                epoch: 2,
                joinedParticipants: ["churnalice", "churncarol"],
                pendingParticipants: ["churnbobbb"],
            }),
        ).toBe(true);
    });

    it("rejects lower epoch that demotes an unrelated joined member", () => {
        const run = emptyGroupRun();
        run.sessionSnapshotEpoch = 3;
        run.sessionRoster.set("churnalice", { account: "churnalice", joinedAt: 1 });
        run.sessionRoster.set("churnbobbb", { account: "churnbobbb", joinedAt: 2 });
        run.sessionRoster.set("churncarol", { account: "churncarol", joinedAt: 3 });
        expect(
            shouldApplyStaleSessionSnapshot(run, {
                t: "sessionSnapshot",
                sessionId: "wrtc:g",
                epoch: 2,
                joinedParticipants: ["churncarol", "churnbobbb"],
                pendingParticipants: ["churnalice"],
            }),
        ).toBe(false);
    });
});

describe("mergeRosterIntoRun — inviter first snapshot", () => {
    it("single-account batch keeps inviter as earliest joiner", () => {
        const run = emptyGroupRun();
        const inviter = "myprod";
        mergeRosterIntoRun(run, [inviter], [], inviter);
        mergeRosterIntoRun(run, [inviter, "carolcarol"], [], inviter);
        expect(
            shouldInitiateOffer("carolcarol", inviter, run.sessionRoster),
        ).toBe(true);
        expect(
            shouldInitiateOffer(inviter, "carolcarol", run.sessionRoster),
        ).toBe(false);
    });
});
