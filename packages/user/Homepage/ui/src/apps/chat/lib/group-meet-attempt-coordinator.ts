/**
 * Single owner of group Meet "attempt identity": which objective session and
 * lifecycle phase are current for a space, and whether incoming WS frames
 * belong to the current attempt or are stale.
 */

export type GroupMeetAttemptKind =
    | "none"
    | "outgoingFresh"
    | "incomingPending"
    | "joined"
    | "leaving"
    | "leftRejoinable";

export type GroupMeetAttemptRole = "host" | "callee" | "rejoiner" | null;

export type GroupMeetFrameDecision =
    | { action: "accept-current" }
    | { action: "create-pending-invite" }
    | { action: "refresh-pending-invite" }
    | { action: "ignore-stale"; reason: string }
    | { action: "replace-with-fresh" }
    | { action: "rejoin-existing"; sessionId: string };

export type GroupMeetAttemptEntry = {
    kind: GroupMeetAttemptKind;
    role: GroupMeetAttemptRole;
    sessionId: string | null;
    /** Monotonic per-space attempt counter; bumps on fresh host start. */
    generation: number;
    leftAt?: number;
    rejoinHint?: { sessionId: string; joinedCount: number };
};

export type GroupMeetRunContext = {
    phase: string;
    sessionId?: string;
    hasJoined: boolean;
    awaitingInviteAccept?: boolean;
    signalingJoined?: boolean;
};

export type GroupMeetSessionEndedContext = {
    by?: string;
    reason: string;
    joinedRoster: readonly string[];
    pendingRoster: readonly string[];
    peerMediaActive: boolean;
};

export class GroupMeetAttemptCoordinator {
    private readonly bySpace = new Map<string, GroupMeetAttemptEntry>();

    private readonly retiredSessionIds = new Set<string>();

    /** sessionId -> accounts rejoining from pending roster */
    private readonly pendingRejoinAccounts = new Map<string, Set<string>>();

    /** sessionId -> accounts who recently left (suppress stale echoes) */
    private readonly recentDepartures = new Map<string, Set<string>>();

    getAttempt(spaceUuid: string): GroupMeetAttemptEntry | undefined {
        return this.bySpace.get(spaceUuid);
    }

    /** Host clicked Start Meet after full leave or first call. */
    beginOutgoingFresh(spaceUuid: string): GroupMeetFrameDecision {
        const prev = this.bySpace.get(spaceUuid);
        if (prev?.sessionId) {
            this.retiredSessionIds.add(prev.sessionId);
        }
        this.bySpace.set(spaceUuid, {
            kind: "outgoingFresh",
            role: "host",
            sessionId: null,
            generation: (prev?.generation ?? 0) + 1,
        });
        return { action: "replace-with-fresh" };
    }

    /** Leaver clicked Rejoin to an existing live session. */
    beginRejoin(
        spaceUuid: string,
        sessionId: string,
        joinedCount: number,
    ): GroupMeetFrameDecision {
        this.unretireSession(sessionId);
        this.bySpace.set(spaceUuid, {
            kind: "joined",
            role: "rejoiner",
            sessionId,
            generation: (this.bySpace.get(spaceUuid)?.generation ?? 0) + 1,
            rejoinHint: { sessionId, joinedCount },
        });
        return { action: "rejoin-existing", sessionId };
    }

    bindSession(spaceUuid: string, sessionId: string): void {
        const entry = this.bySpace.get(spaceUuid);
        if (!entry) {
            this.bySpace.set(spaceUuid, {
                kind: "joined",
                role: null,
                sessionId,
                generation: 1,
            });
        } else {
            this.bySpace.set(spaceUuid, { ...entry, sessionId });
        }
        this.unretireSession(sessionId);
    }

    markJoined(spaceUuid: string, sessionId: string): void {
        const entry = this.bySpace.get(spaceUuid);
        if (!entry) {
            this.bySpace.set(spaceUuid, {
                kind: "joined",
                role: null,
                sessionId,
                generation: 1,
            });
            return;
        }
        this.bySpace.set(spaceUuid, {
            ...entry,
            kind: "joined",
            sessionId,
            rejoinHint: undefined,
        });
    }

    markIncomingPending(spaceUuid: string, sessionId: string): void {
        this.bySpace.set(spaceUuid, {
            kind: "incomingPending",
            role: "callee",
            sessionId,
            generation: this.bySpace.get(spaceUuid)?.generation ?? 0,
        });
        this.unretireSession(sessionId);
    }

    beginLeave(spaceUuid: string): void {
        const entry = this.bySpace.get(spaceUuid);
        if (!entry) return;
        this.bySpace.set(spaceUuid, {
            ...entry,
            kind: "leaving",
            leftAt: Date.now(),
        });
    }

    completeLeave(
        spaceUuid: string,
        rejoinHint: { sessionId: string; joinedCount: number } | null,
    ): void {
        const entry = this.bySpace.get(spaceUuid);
        if (!entry) return;
        if (rejoinHint && rejoinHint.joinedCount > 0) {
            this.bySpace.set(spaceUuid, {
                ...entry,
                kind: "leftRejoinable",
                leftAt: Date.now(),
                rejoinHint,
            });
        } else {
            if (entry.sessionId) {
                this.retiredSessionIds.add(entry.sessionId);
            }
            this.bySpace.delete(spaceUuid);
        }
    }

    clearSpace(spaceUuid: string): void {
        const entry = this.bySpace.get(spaceUuid);
        if (entry?.sessionId) {
            this.retiredSessionIds.add(entry.sessionId);
        }
        this.bySpace.delete(spaceUuid);
    }

    isLeaveInProgress(spaceUuid: string): boolean {
        return this.bySpace.get(spaceUuid)?.kind === "leaving";
    }

    shouldBlockUiRearm(spaceUuid: string, now = Date.now(), suppressMs = 60_000): boolean {
        const entry = this.bySpace.get(spaceUuid);
        if (!entry) return false;
        // leftRejoinable must allow Meet / rejoin — only block during active hangup.
        if (entry.kind === "leaving") {
            return true;
        }
        return false;
    }

    rejoinHintFromLifecycle(
        spaceUuid: string,
    ): { spaceUuid: string; sessionId: string; joinedCount: number } | null {
        const entry = this.bySpace.get(spaceUuid);
        if (entry?.kind !== "leftRejoinable" || !entry.rejoinHint) return null;
        if (entry.rejoinHint.joinedCount <= 0) return null;
        return {
            spaceUuid,
            sessionId: entry.rejoinHint.sessionId,
            joinedCount: entry.rejoinHint.joinedCount,
        };
    }

    classifySessionInvite(
        spaceUuid: string,
        sessionId: string,
        run: GroupMeetRunContext | null,
        opts: { leaveInProgress: boolean },
    ): GroupMeetFrameDecision {
        if (opts.leaveInProgress) {
            return {
                action: "ignore-stale",
                reason: "group leave in progress",
            };
        }

        const attempt = this.bySpace.get(spaceUuid);

        if (attempt?.kind === "leaving") {
            return {
                action: "ignore-stale",
                reason: "group leave in progress",
            };
        }

        if (this.retiredSessionIds.has(sessionId)) {
            if (
                attempt?.kind === "outgoingFresh" ||
                attempt?.role === "rejoiner"
            ) {
                this.unretireSession(sessionId);
            } else {
                return {
                    action: "ignore-stale",
                    reason: "retired session",
                };
            }
        }

        if (
            attempt?.kind === "leftRejoinable" &&
            attempt.rejoinHint?.sessionId === sessionId
        ) {
            return {
                action: "ignore-stale",
                reason: "mesh echo during leftRejoinable",
            };
        }

        if (
            run?.sessionId &&
            run.sessionId !== sessionId &&
            run.phase !== "idle" &&
            run.phase !== "failed"
        ) {
            return {
                action: "ignore-stale",
                reason: "session id mismatch on invite",
            };
        }

        if (run?.awaitingInviteAccept && run.sessionId === sessionId) {
            return { action: "refresh-pending-invite" };
        }

        if (
            run?.sessionId === sessionId &&
            run.phase === "waiting-peer" &&
            !run.hasJoined
        ) {
            return { action: "refresh-pending-invite" };
        }

        if (
            run?.sessionId === sessionId &&
            run.phase !== "idle" &&
            run.phase !== "failed"
        ) {
            const duplicateWhileActive =
                (run.phase === "waiting-peer" && run.hasJoined) ||
                run.phase === "joining" ||
                run.phase === "signaling" ||
                run.phase === "ready" ||
                (run.hasJoined && run.signalingJoined === true);

            if (duplicateWhileActive) {
                if (
                    attempt?.kind === "leftRejoinable" &&
                    attempt.rejoinHint?.sessionId === sessionId
                ) {
                    return {
                        action: "ignore-stale",
                        reason: "mesh invite echo during rejoinable leave",
                    };
                }
                return {
                    action: "ignore-stale",
                    reason: "duplicate invite for active session",
                };
            }
        }

        if (
            !attempt ||
            attempt.kind === "none" ||
            attempt.kind === "outgoingFresh" ||
            attempt.kind === "joined"
        ) {
            this.markIncomingPending(spaceUuid, sessionId);
            return { action: "create-pending-invite" };
        }

        if (attempt.kind === "incomingPending" && attempt.sessionId === sessionId) {
            return { action: "refresh-pending-invite" };
        }

        this.markIncomingPending(spaceUuid, sessionId);
        return { action: "create-pending-invite" };
    }

    classifyParticipantJoined(
        spaceUuid: string,
        sessionId: string,
        run: GroupMeetRunContext | null,
    ): GroupMeetFrameDecision {
        if (this.retiredSessionIds.has(sessionId)) {
            return {
                action: "ignore-stale",
                reason: "retired session",
            };
        }

        const attempt = this.bySpace.get(spaceUuid);

        if (
            attempt?.kind === "leftRejoinable" &&
            attempt.rejoinHint?.sessionId === sessionId
        ) {
            return {
                action: "ignore-stale",
                reason: "participantJoined mesh echo during leftRejoinable",
            };
        }

        if (run?.awaitingInviteAccept) {
            return {
                action: "ignore-stale",
                reason: "pending invite accept",
            };
        }

        if (
            attempt?.kind === "incomingPending" &&
            attempt.sessionId === sessionId
        ) {
            return {
                action: "ignore-stale",
                reason: "participantJoined before invite accept",
            };
        }

        if (run?.sessionId && run.sessionId !== sessionId) {
            return {
                action: "ignore-stale",
                reason: "cross-session participantJoined",
            };
        }

        return { action: "accept-current" };
    }

    classifySessionEnded(
        sessionId: string,
        ctx: GroupMeetSessionEndedContext,
    ): GroupMeetFrameDecision {
        if (this.retiredSessionIds.has(sessionId)) {
            return {
                action: "ignore-stale",
                reason: "retired session",
            };
        }

        if (
            ctx.reason === "left" &&
            ctx.by &&
            this.isPendingRejoin(sessionId, ctx.by) &&
            ctx.pendingRoster.includes(ctx.by)
        ) {
            return {
                action: "ignore-stale",
                reason: "stale leave while rejoin pending",
            };
        }

        if (ctx.by) {
            this.markRecentDeparture(sessionId, ctx.by);
        }

        return { action: "accept-current" };
    }

    /** Whether a run lookup by group member should match this session. */
    runMatchesSession(
        runSessionId: string | undefined,
        frameSessionId: string,
    ): boolean {
        if (runSessionId === frameSessionId) return true;
        if (!runSessionId) return false;
        return false;
    }

    retireSession(sessionId: string): void {
        this.retiredSessionIds.add(sessionId);
    }

    unretireSession(sessionId: string): void {
        this.retiredSessionIds.delete(sessionId);
    }

    isRetiredSession(sessionId: string): boolean {
        return this.retiredSessionIds.has(sessionId);
    }

    markPendingRejoin(sessionId: string, participant: string): void {
        let accounts = this.pendingRejoinAccounts.get(sessionId);
        if (!accounts) {
            accounts = new Set();
            this.pendingRejoinAccounts.set(sessionId, accounts);
        }
        accounts.add(participant);
        this.recentDepartures.get(sessionId)?.delete(participant);
    }

    isPendingRejoin(sessionId: string, participant: string): boolean {
        return (
            this.pendingRejoinAccounts.get(sessionId)?.has(participant) ?? false
        );
    }

    clearPendingRejoin(sessionId: string, participant: string): void {
        const accounts = this.pendingRejoinAccounts.get(sessionId);
        if (!accounts) return;
        accounts.delete(participant);
        if (accounts.size === 0) {
            this.pendingRejoinAccounts.delete(sessionId);
        }
    }

    clearSessionRejoinState(sessionId: string): void {
        this.pendingRejoinAccounts.delete(sessionId);
        this.recentDepartures.delete(sessionId);
    }

    isRecentDeparture(sessionId: string, participant: string): boolean {
        return (
            this.recentDepartures.get(sessionId)?.has(participant) ?? false
        );
    }

    markRecentDeparture(sessionId: string, participant: string): void {
        let departed = this.recentDepartures.get(sessionId);
        if (!departed) {
            departed = new Set();
            this.recentDepartures.set(sessionId, departed);
        }
        departed.add(participant);
    }

    noteRosterPromotion(sessionId: string, participant: string): void {
        if (!this.isRecentDeparture(sessionId, participant)) {
            this.clearPendingRejoin(sessionId, participant);
        }
    }

    noteRosterPendingFromJoined(sessionId: string, participant: string): void {
        this.markPendingRejoin(sessionId, participant);
    }
}
