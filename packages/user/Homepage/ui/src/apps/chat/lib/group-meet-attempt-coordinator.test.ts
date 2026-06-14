import { describe, expect, it } from "vitest";

import {
    GroupMeetAttemptCoordinator,
    type GroupMeetRunContext,
} from "./group-meet-attempt-coordinator";

const SPACE = "space-uuid-1";
const SESSION_A = "session-a";
const SESSION_B = "session-b";

describe("GroupMeetAttemptCoordinator", () => {
    describe("fresh host attempt after full leave", () => {
        it("retires previous session and bumps generation on outgoing fresh", () => {
            const coord = new GroupMeetAttemptCoordinator();
            coord.bindSession(SPACE, SESSION_A);
            coord.markJoined(SPACE, SESSION_A);
            coord.completeLeave(SPACE, null);

            const decision = coord.beginOutgoingFresh(SPACE);
            expect(decision).toEqual({ action: "replace-with-fresh" });
            expect(coord.isRetiredSession(SESSION_A)).toBe(true);
            expect(coord.getAttempt(SPACE)?.kind).toBe("outgoingFresh");
            expect(coord.getAttempt(SPACE)?.generation).toBeGreaterThan(0);
        });

        it("ignores stale sessionEnded for retired session", () => {
            const coord = new GroupMeetAttemptCoordinator();
            coord.bindSession(SPACE, SESSION_A);
            coord.beginOutgoingFresh(SPACE);

            const decision = coord.classifySessionEnded(SESSION_A, {
                reason: "left",
                by: "bob",
                joinedRoster: [],
                pendingRoster: [],
                peerMediaActive: false,
            });
            expect(decision).toEqual({
                action: "ignore-stale",
                reason: "retired session",
            });
        });

        it("classifies invite after full leave as pending incoming", () => {
            const coord = new GroupMeetAttemptCoordinator();
            coord.bindSession(SPACE, SESSION_A);
            coord.completeLeave(SPACE, null);

            const decision = coord.classifySessionInvite(
                SPACE,
                SESSION_B,
                null,
                { leaveInProgress: false },
            );
            expect(decision).toEqual({ action: "create-pending-invite" });
            expect(coord.getAttempt(SPACE)?.kind).toBe("incomingPending");
        });

        it("classifies invite to new session after fresh start as pending", () => {
            const coord = new GroupMeetAttemptCoordinator();
            coord.bindSession(SPACE, SESSION_A);
            coord.beginOutgoingFresh(SPACE);

            const decision = coord.classifySessionInvite(
                SPACE,
                SESSION_B,
                null,
                { leaveInProgress: false },
            );
            expect(decision).toEqual({ action: "create-pending-invite" });
            expect(coord.getAttempt(SPACE)?.kind).toBe("incomingPending");
            expect(coord.getAttempt(SPACE)?.sessionId).toBe(SESSION_B);
        });
    });

    describe("participantJoined before sessionInvite", () => {
        it("defers participantJoined while awaiting invite accept", () => {
            const coord = new GroupMeetAttemptCoordinator();
            const run: GroupMeetRunContext = {
                phase: "waiting-peer",
                sessionId: SESSION_A,
                hasJoined: false,
                awaitingInviteAccept: true,
            };

            const decision = coord.classifyParticipantJoined(
                SPACE,
                SESSION_A,
                run,
            );
            expect(decision).toEqual({
                action: "ignore-stale",
                reason: "pending invite accept",
            });
        });

        it("refreshes pending invite on duplicate while awaiting accept", () => {
            const coord = new GroupMeetAttemptCoordinator();
            const run: GroupMeetRunContext = {
                phase: "waiting-peer",
                sessionId: SESSION_A,
                hasJoined: false,
                awaitingInviteAccept: true,
            };

            const decision = coord.classifySessionInvite(
                SPACE,
                SESSION_A,
                run,
                { leaveInProgress: false },
            );
            expect(decision).toEqual({ action: "refresh-pending-invite" });
        });

        it("ignores participantJoined for incoming pending before accept", () => {
            const coord = new GroupMeetAttemptCoordinator();
            coord.markIncomingPending(SPACE, SESSION_A);

            const decision = coord.classifyParticipantJoined(
                SPACE,
                SESSION_A,
                {
                    phase: "idle",
                    hasJoined: false,
                },
            );
            expect(decision).toEqual({
                action: "ignore-stale",
                reason: "participantJoined before invite accept",
            });
        });
    });

    describe("stale sessionEnded after rejoin", () => {
        it("ignores stale leave when participant still active with media", () => {
            const coord = new GroupMeetAttemptCoordinator();
            coord.beginRejoin(SPACE, SESSION_A, 2);

            const decision = coord.classifySessionEnded(SESSION_A, {
                reason: "left",
                by: "alice",
                joinedRoster: ["alice", "bob"],
                pendingRoster: [],
                peerMediaActive: true,
            });
            expect(decision).toEqual({ action: "accept-current" });
        });

        it("ignores stale leave while rejoin pending on roster", () => {
            const coord = new GroupMeetAttemptCoordinator();
            coord.markPendingRejoin(SESSION_A, "carol");

            const decision = coord.classifySessionEnded(SESSION_A, {
                reason: "left",
                by: "carol",
                joinedRoster: ["alice", "bob"],
                pendingRoster: ["carol"],
                peerMediaActive: false,
            });
            expect(decision).toEqual({
                action: "ignore-stale",
                reason: "stale leave while rejoin pending",
            });
        });
    });

    describe("partial rejoin while survivors stay connected", () => {
        it("rejoin attempt binds to existing session", () => {
            const coord = new GroupMeetAttemptCoordinator();
            coord.completeLeave(SPACE, {
                sessionId: SESSION_A,
                joinedCount: 2,
            });

            const decision = coord.beginRejoin(SPACE, SESSION_A, 2);
            expect(decision).toEqual({
                action: "rejoin-existing",
                sessionId: SESSION_A,
            });
            expect(coord.getAttempt(SPACE)?.role).toBe("rejoiner");
            expect(coord.isRetiredSession(SESSION_A)).toBe(false);
        });

        it("accepts participantJoined for current rejoin session", () => {
            const coord = new GroupMeetAttemptCoordinator();
            coord.beginRejoin(SPACE, SESSION_A, 2);

            const decision = coord.classifyParticipantJoined(
                SPACE,
                SESSION_A,
                {
                    phase: "signaling",
                    sessionId: SESSION_A,
                    hasJoined: true,
                    signalingJoined: true,
                },
            );
            expect(decision).toEqual({ action: "accept-current" });
        });
    });

    describe("all members left then new host attempt", () => {
        it("must be fresh rather than rejoin when no survivors", () => {
            const coord = new GroupMeetAttemptCoordinator();
            coord.bindSession(SPACE, SESSION_A);
            coord.markJoined(SPACE, SESSION_A);
            coord.completeLeave(SPACE, null);

            expect(coord.getAttempt(SPACE)).toBeUndefined();
            const decision = coord.beginOutgoingFresh(SPACE);
            expect(decision.action).toBe("replace-with-fresh");
            expect(coord.getAttempt(SPACE)?.kind).toBe("outgoingFresh");
        });

        it("blocks invite during leave in progress", () => {
            const coord = new GroupMeetAttemptCoordinator();
            coord.bindSession(SPACE, SESSION_A);
            coord.beginLeave(SPACE);

            const decision = coord.classifySessionInvite(
                SPACE,
                SESSION_A,
                {
                    phase: "signaling",
                    sessionId: SESSION_A,
                    hasJoined: true,
                },
                { leaveInProgress: true },
            );
            expect(decision).toEqual({
                action: "ignore-stale",
                reason: "group leave in progress",
            });
        });
    });

    describe("stale event ordering", () => {
        it("ignores cross-session participantJoined", () => {
            const coord = new GroupMeetAttemptCoordinator();
            const decision = coord.classifyParticipantJoined(
                SPACE,
                SESSION_B,
                {
                    phase: "signaling",
                    sessionId: SESSION_A,
                    hasJoined: true,
                },
            );
            expect(decision).toEqual({
                action: "ignore-stale",
                reason: "cross-session participantJoined",
            });
        });

        it("ignores duplicate invite for established session", () => {
            const coord = new GroupMeetAttemptCoordinator();
            const run: GroupMeetRunContext = {
                phase: "ready",
                sessionId: SESSION_A,
                hasJoined: true,
                signalingJoined: true,
            };

            const decision = coord.classifySessionInvite(
                SPACE,
                SESSION_A,
                run,
                { leaveInProgress: false },
            );
            expect(decision).toEqual({
                action: "ignore-stale",
                reason: "duplicate invite for active session",
            });
        });

        it("unretires session when accepting a fresh invite", () => {
            const coord = new GroupMeetAttemptCoordinator();
            coord.retireSession(SESSION_A);

            const decision = coord.classifySessionInvite(
                SPACE,
                SESSION_B,
                null,
                { leaveInProgress: false },
            );
            expect(decision).toEqual({ action: "create-pending-invite" });
            expect(coord.isRetiredSession(SESSION_B)).toBe(false);
        });

        it("ignores invite for retired session with no local attempt", () => {
            const coord = new GroupMeetAttemptCoordinator();
            coord.retireSession(SESSION_A);

            const decision = coord.classifySessionInvite(
                SPACE,
                SESSION_A,
                null,
                { leaveInProgress: false },
            );
            expect(decision).toEqual({
                action: "ignore-stale",
                reason: "retired session",
            });
            expect(coord.isRetiredSession(SESSION_A)).toBe(true);
        });

        it("ignores stale invite to retired session after full group leave", () => {
            const coord = new GroupMeetAttemptCoordinator();
            coord.bindSession(SPACE, SESSION_A);
            coord.completeLeave(SPACE, null);

            const decision = coord.classifySessionInvite(
                SPACE,
                SESSION_A,
                null,
                { leaveInProgress: false },
            );
            expect(decision).toEqual({
                action: "ignore-stale",
                reason: "retired session",
            });
        });

        it("refreshes invite for callee still ringing", () => {
            const coord = new GroupMeetAttemptCoordinator();
            const run: GroupMeetRunContext = {
                phase: "waiting-peer",
                sessionId: SESSION_A,
                hasJoined: false,
            };

            const decision = coord.classifySessionInvite(
                SPACE,
                SESSION_A,
                run,
                { leaveInProgress: false },
            );
            expect(decision).toEqual({ action: "refresh-pending-invite" });
        });
    });

    describe("lifecycle UI hints", () => {
        it("exposes leftRejoinable hint after partial leave", () => {
            const coord = new GroupMeetAttemptCoordinator();
            coord.bindSession(SPACE, SESSION_A);
            coord.beginLeave(SPACE);
            coord.completeLeave(SPACE, {
                sessionId: SESSION_A,
                joinedCount: 2,
            });

            expect(coord.getAttempt(SPACE)?.kind).toBe("leftRejoinable");
            expect(coord.rejoinHintFromLifecycle(SPACE)).toEqual({
                spaceUuid: SPACE,
                sessionId: SESSION_A,
                joinedCount: 2,
            });
            expect(coord.shouldBlockUiRearm(SPACE)).toBe(false);
        });

        it("accepts invite for callee in leftRejoinable state when host starts new session", () => {
            const coord = new GroupMeetAttemptCoordinator();
            coord.completeLeave(SPACE, {
                sessionId: SESSION_A,
                joinedCount: 2,
            });

            const decision = coord.classifySessionInvite(
                SPACE,
                SESSION_B,
                null,
                { leaveInProgress: false },
            );
            expect(decision).toEqual({ action: "create-pending-invite" });
            expect(coord.getAttempt(SPACE)?.kind).toBe("incomingPending");
        });

        it("ignores mesh echo invite for live session while leftRejoinable", () => {
            const coord = new GroupMeetAttemptCoordinator();
            coord.bindSession(SPACE, SESSION_A);
            coord.beginLeave(SPACE);
            coord.completeLeave(SPACE, {
                sessionId: SESSION_A,
                joinedCount: 2,
            });

            const decision = coord.classifySessionInvite(
                SPACE,
                SESSION_A,
                null,
                { leaveInProgress: false },
            );
            expect(decision).toEqual({
                action: "ignore-stale",
                reason: "mesh echo during leftRejoinable",
            });
            expect(coord.getAttempt(SPACE)?.kind).toBe("leftRejoinable");
        });
    });
});
