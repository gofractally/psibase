/** Local UI lifecycle for group Meet calls (one space at a time per client). */
export type GroupMeetLifecyclePhase =
    | "inactive"
    | "active"
    | "leaving"
    | "leftRejoinable";

export type GroupMeetRejoinHint = {
    spaceUuid: string;
    sessionId: string;
    joinedCount: number;
};

export type GroupMeetLifecycleEntry = {
    phase: GroupMeetLifecyclePhase;
    leftAt?: number;
    rejoinHint?: Omit<GroupMeetRejoinHint, "spaceUuid">;
};

export type GroupMeetLifecycleBySpace = Record<string, GroupMeetLifecycleEntry>;

export function getGroupMeetLifecycle(
    map: GroupMeetLifecycleBySpace,
    spaceUuid: string,
): GroupMeetLifecycleEntry | undefined {
    return map[spaceUuid];
}

export function shouldBlockGroupMeetRearm(
    map: GroupMeetLifecycleBySpace,
    spaceUuid: string,
    now = Date.now(),
    suppressMs = 60_000,
): boolean {
    const entry = map[spaceUuid];
    if (!entry) return false;
    // leftRejoinable shows rejoin banner / Meet — do not block UI re-arm.
    if (entry.phase === "leaving") {
        return true;
    }
    return false;
}

/** True only while local hangup is still tearing down — not after leftRejoinable. */
export function isGroupMeetLeaveInProgress(
    map: GroupMeetLifecycleBySpace,
    spaceUuid: string,
): boolean {
    return map[spaceUuid]?.phase === "leaving";
}

export function markGroupMeetActive(
    map: GroupMeetLifecycleBySpace,
    spaceUuid: string,
): GroupMeetLifecycleBySpace {
    return {
        ...map,
        [spaceUuid]: { phase: "active" },
    };
}

export function beginGroupMeetLeave(
    map: GroupMeetLifecycleBySpace,
    spaceUuid: string,
    now = Date.now(),
): GroupMeetLifecycleBySpace {
    return {
        ...map,
        [spaceUuid]: { phase: "leaving", leftAt: now },
    };
}

export function completeGroupMeetLeave(
    map: GroupMeetLifecycleBySpace,
    spaceUuid: string,
    rejoinHint: GroupMeetRejoinHint | null,
    now = Date.now(),
): GroupMeetLifecycleBySpace {
    if (!rejoinHint || rejoinHint.joinedCount <= 0) {
        return clearGroupMeetLifecycle(map, spaceUuid);
    }
    return {
        ...map,
        [spaceUuid]: {
            phase: "leftRejoinable",
            leftAt: now,
            rejoinHint: {
                sessionId: rejoinHint.sessionId,
                joinedCount: rejoinHint.joinedCount,
            },
        },
    };
}

export function clearGroupMeetLifecycle(
    map: GroupMeetLifecycleBySpace,
    spaceUuid: string,
): GroupMeetLifecycleBySpace {
    if (!(spaceUuid in map)) return map;
    const next = { ...map };
    delete next[spaceUuid];
    return next;
}

export function rejoinHintFromLifecycle(
    map: GroupMeetLifecycleBySpace,
    spaceUuid: string,
): GroupMeetRejoinHint | null {
    const entry = map[spaceUuid];
    if (entry?.phase !== "leftRejoinable" || !entry.rejoinHint) return null;
    if (entry.rejoinHint.joinedCount <= 0) return null;
    return {
        spaceUuid,
        sessionId: entry.rejoinHint.sessionId,
        joinedCount: entry.rejoinHint.joinedCount,
    };
}
