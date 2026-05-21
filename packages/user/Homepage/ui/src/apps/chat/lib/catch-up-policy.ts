/**
 * Catch-up mode when a mesh data channel opens to a remote peer.
 *
 * - lateJoiner: peer was offline when our session run started → push history.
 * - returningMember: peer was online at start but went away and came back →
 *   push history (fresh browser / cleared storage) and force pending flush.
 * - active: peer has been continuously online → no history push.
 */
export type CatchUpMode =
    | { kind: "lateJoiner" }
    | { kind: "returningMember" }
    | { kind: "active" };

export type CatchUpPolicyInput = {
    /** Was the remote online when this space run was created? */
    peerWasOnlineAtSessionStart: boolean;
    /** Is the remote currently presence-online? */
    peerIsOnlineNow: boolean;
    /** Did we ever have an open data channel to this peer in this run? */
    hadOpenDataChannel: boolean;
};

export function resolveCatchUpMode(
    input: CatchUpPolicyInput,
): CatchUpMode {
    if (!input.peerWasOnlineAtSessionStart) {
        return { kind: "lateJoiner" };
    }
    if (input.peerIsOnlineNow && input.hadOpenDataChannel) {
        return { kind: "returningMember" };
    }
    return { kind: "active" };
}

/** True when we should push local history to the remote on DC open. */
export function shouldPushHistoryOnConnect(input: CatchUpPolicyInput): boolean {
    const mode = resolveCatchUpMode(input);
    return mode.kind === "lateJoiner" || mode.kind === "returningMember";
}

/** True when we should force-flush pending rows to this recipient on DC open. */
export function shouldForcePendingFlushOnConnect(
    input: CatchUpPolicyInput,
): boolean {
    const mode = resolveCatchUpMode(input);
    return mode.kind === "lateJoiner" || mode.kind === "returningMember";
}
