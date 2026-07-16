import type { AvRunEvent } from "./av-call-run-state-machine";
import { avCallLog, shortSessionId } from "./av-call-debug";
import type { GroupMeetAttemptCoordinator } from "./group-meet-attempt-coordinator";
import type { AvCallSpaceRun } from "./av-call-session-types";

/**
 * Local mirror of the x-wrtcsig joined/pending roster per objective av-call
 * session (not pair sessions). Extracted from `AvCallSessionOrchestrator` —
 * see that class's roster-delegate methods (`recordAvCallSessionSnapshot`,
 * `getAvCallSessionJoinedParticipants`, etc.) for the public API this backs.
 */

export type AvCallSessionRosterEntry = {
    joined: string[];
    pending: string[];
    epoch: number;
};

export type AvCallSessionRosterDeps = {
    getSelf: () => string | null;
    findRunBySessionId: (sessionId: string) => AvCallSpaceRun | undefined;
    dispatchRunEventAndWait: (
        run: AvCallSpaceRun,
        event: AvRunEvent,
    ) => Promise<void>;
    groupMeetAttempts: GroupMeetAttemptCoordinator;
};

export class AvCallSessionRosterStore {
    private readonly rosters = new Map<string, AvCallSessionRosterEntry>();

    constructor(private readonly deps: AvCallSessionRosterDeps) {}

    clear(): void {
        this.rosters.clear();
    }

    delete(sessionId: string): void {
        this.rosters.delete(sessionId);
    }

    recordSnapshot(
        sessionId: string,
        joinedParticipants: string[],
        pendingParticipants: string[],
        epoch?: number,
    ): void {
        if (sessionId.startsWith("wrtc:pair:")) return;
        const prev = this.rosters.get(sessionId);
        const clearing =
            joinedParticipants.length === 0 && pendingParticipants.length === 0;
        if (!clearing && epoch != null && prev != null && epoch <= prev.epoch) {
            return;
        }
        if (prev) {
            for (const participant of joinedParticipants) {
                if (
                    prev.pending.includes(participant) &&
                    !prev.joined.includes(participant) &&
                    !this.isRecentDeparture(sessionId, participant)
                ) {
                    this.clearPendingRejoin(sessionId, participant);
                } else if (prev.joined.includes(participant)) {
                    this.clearPendingRejoin(sessionId, participant);
                }
            }
            for (const participant of pendingParticipants) {
                if (prev.joined.includes(participant)) {
                    this.markPendingRejoin(sessionId, participant);
                }
            }
        }
        this.rosters.set(sessionId, {
            joined: [...joinedParticipants],
            pending: [...pendingParticipants],
            epoch: epoch ?? (prev?.epoch ?? 0) + 1,
        });
        if (clearing) {
            this.deps.groupMeetAttempts.clearSessionRejoinState(sessionId);
        }
    }

    applySnapshotFromRealtime(
        sessionId: string,
        joinedParticipants: string[],
        pendingParticipants: string[],
        epoch?: number,
    ): void {
        if (sessionId.startsWith("wrtc:pair:")) return;
        const prev = this.rosters.get(sessionId);
        const clearing =
            joinedParticipants.length === 0 && pendingParticipants.length === 0;
        if (!clearing && epoch != null && prev != null && epoch <= prev.epoch) {
            if (epoch < prev.epoch) {
                avCallLog("sessionSnapshot ignored (epoch regression)", {
                    sessionId: shortSessionId(sessionId),
                    epoch,
                    prevEpoch: prev.epoch,
                });
            }
            return;
        }

        const self = this.deps.getSelf();
        if (prev && self && !clearing) {
            const joined = joinedParticipants;
            const pending = pendingParticipants;
            for (const participant of prev.joined) {
                if (participant === self) continue;
                if (joined.includes(participant)) continue;
                if (pending.includes(participant)) {
                    this.markPendingRejoin(sessionId, participant);
                    const run = this.deps.findRunBySessionId(sessionId);
                    if (
                        run &&
                        this.deps.dispatchRunEventAndWait &&
                        !this.isRecentDeparture(sessionId, participant)
                    ) {
                        avCallLog("sessionSnapshot: roster moved to pending", {
                            sessionId: shortSessionId(sessionId),
                            participant,
                        });
                        void this.deps
                            .dispatchRunEventAndWait(run, {
                                type: "sessionEnded",
                                sessionId,
                                reason: "left",
                                by: participant,
                            })
                            .then(() => run.onUpdate());
                    }
                    continue;
                }
                const run = this.deps.findRunBySessionId(sessionId);
                if (run && this.deps.dispatchRunEventAndWait) {
                    avCallLog("sessionSnapshot: roster departure", {
                        sessionId: shortSessionId(sessionId),
                        participant,
                    });
                    void this.deps
                        .dispatchRunEventAndWait(run, {
                            type: "sessionEnded",
                            sessionId,
                            reason: "left",
                            by: participant,
                        })
                        .then(() => run.onUpdate());
                }
            }
        }

        this.recordSnapshot(
            sessionId,
            joinedParticipants,
            pendingParticipants,
            epoch,
        );
    }

    promoteParticipantToJoined(sessionId: string, participant: string): void {
        if (sessionId.startsWith("wrtc:pair:")) return;
        const roster = this.rosters.get(sessionId);
        if (!roster) {
            this.rosters.set(sessionId, {
                joined: [participant],
                pending: [],
                epoch: 1,
            });
            this.clearPendingRejoin(sessionId, participant);
            return;
        }
        const joined = new Set(roster.joined);
        joined.add(participant);
        this.rosters.set(sessionId, {
            joined: [...joined],
            pending: roster.pending.filter((p) => p !== participant),
            epoch: roster.epoch,
        });
        if (!this.isRecentDeparture(sessionId, participant)) {
            this.clearPendingRejoin(sessionId, participant);
        }
        this.deps.groupMeetAttempts.noteRosterPromotion(sessionId, participant);
    }

    markPendingRejoin(sessionId: string, participant: string): void {
        if (sessionId.startsWith("wrtc:pair:")) return;
        this.deps.groupMeetAttempts.markPendingRejoin(sessionId, participant);
    }

    isPendingRejoin(sessionId: string, participant: string): boolean {
        return this.deps.groupMeetAttempts.isPendingRejoin(sessionId, participant);
    }

    clearPendingRejoin(sessionId: string, participant: string): void {
        this.deps.groupMeetAttempts.clearPendingRejoin(sessionId, participant);
    }

    isRecentDeparture(sessionId: string, participant: string): boolean {
        return this.deps.groupMeetAttempts.isRecentDeparture(
            sessionId,
            participant,
        );
    }

    removeParticipant(sessionId: string, participant: string): void {
        if (sessionId.startsWith("wrtc:pair:")) return;
        const roster = this.rosters.get(sessionId);
        if (!roster) return;
        this.rosters.set(sessionId, {
            joined: roster.joined.filter((p) => p !== participant),
            pending: roster.pending.filter((p) => p !== participant),
            epoch: roster.epoch,
        });
        this.deps.groupMeetAttempts.markRecentDeparture(sessionId, participant);
    }

    othersStillJoined(sessionId: string, self: string): boolean {
        const roster = this.rosters.get(sessionId);
        if (!roster) return false;
        return roster.joined.some((p) => p !== self);
    }

    getJoinedCount(sessionId: string): number {
        return this.rosters.get(sessionId)?.joined.length ?? 0;
    }

    getJoinedParticipants(sessionId: string): readonly string[] {
        return this.rosters.get(sessionId)?.joined ?? [];
    }

    getPendingParticipants(sessionId: string): readonly string[] {
        return this.rosters.get(sessionId)?.pending ?? [];
    }
}
