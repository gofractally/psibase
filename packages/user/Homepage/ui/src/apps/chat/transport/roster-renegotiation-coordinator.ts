import { chatDataRecord } from "../lib/chat-data-debug";
import { PEER_ESTABLISHING_STUCK_MS, type EnsureReason, type PeerState } from "./types";

export type PeerRosterSnapshot = {
    remote: string;
    state: PeerState;
    negotiationStartedAt: number | null;
    isJoined: boolean;
    isInitiator: boolean;
    hasPeer: boolean;
};

export type RosterRenegotiationActions = {
    ensure: (remote: string, reason: EnsureReason) => void;
    resendOffer: (remote: string) => void;
    retriggerHandshake: (remote: string) => void;
    recoverPeer: (remote: string, reason: string) => void;
};

export type RosterRenegotiationCoordinator = {
    notifyRemoteReachable: (remote: string, source: EnsureReason) => void;
    notifyPairRosterUpdate: (
        remote: string,
        source: EnsureReason,
    ) => void;
    notifyJoinBatchIdle: (completedPairId: string | undefined) => void;
    dispose: () => void;
};

const ROSTER_SOURCES = new Set<EnsureReason>([
    "presence_online",
    "peer_joined",
    "roster_kick",
]);

export function isRosterRenegotiationSource(source: EnsureReason): boolean {
    return ROSTER_SOURCES.has(source);
}

export function createRosterRenegotiationCoordinator(deps: {
    localAccount: string;
    pairIdForRemote: (remote: string) => string;
    remoteForPairId: (pairId: string) => string | null;
    getSnapshot: (remote: string) => PeerRosterSnapshot | null;
    actions: RosterRenegotiationActions;
    debounceMs?: number;
    now?: () => number;
}): RosterRenegotiationCoordinator {
    const debounceMs = deps.debounceMs ?? 150;
    const now = deps.now ?? (() => Date.now());
    const pending = new Map<
        string,
        { source: EnsureReason; timer: ReturnType<typeof setTimeout> }
    >();
    const resendWindowStart = new Map<string, number>();

    const cancelPending = (remote: string) => {
        const row = pending.get(remote);
        if (!row) return;
        clearTimeout(row.timer);
        pending.delete(remote);
    };

    const schedule = (remote: string, source: EnsureReason) => {
        if (remote === deps.localAccount) return;
        const existing = pending.get(remote);
        if (existing) {
            clearTimeout(existing.timer);
        }
        const timer = setTimeout(() => {
            pending.delete(remote);
            decide(remote, source);
        }, debounceMs);
        pending.set(remote, { source, timer });
    };

    const decide = (remote: string, source: EnsureReason) => {
        const snap = deps.getSnapshot(remote);
        if (!snap) {
            deps.actions.ensure(remote, source);
            return;
        }

        chatDataRecord("roster-coordinator-decide", {
            remote,
            source,
            state: snap.state,
            isInitiator: snap.isInitiator,
            isJoined: snap.isJoined,
            hasPeer: snap.hasPeer,
        });

        if (snap.state === "usable") return;

        if (snap.state === "joining_pair" || snap.state === "waiting_ws") {
            return;
        }

        const ageMs =
            snap.negotiationStartedAt != null
                ? now() - snap.negotiationStartedAt
                : Number.POSITIVE_INFINITY;

        if (snap.state === "negotiating" && snap.hasPeer) {
            if (ageMs < PEER_ESTABLISHING_STUCK_MS) {
                if (snap.isInitiator) {
                    const windowStart = resendWindowStart.get(remote);
                    if (
                        windowStart == null ||
                        now() - windowStart >= PEER_ESTABLISHING_STUCK_MS
                    ) {
                        resendWindowStart.set(remote, now());
                        deps.actions.resendOffer(remote);
                    }
                }
                return;
            }
            deps.actions.recoverPeer(remote, "roster-coordinator-stuck");
            return;
        }

        if (snap.isJoined) {
            deps.actions.retriggerHandshake(remote);
            return;
        }

        deps.actions.ensure(remote, source);
    };

    return {
        notifyRemoteReachable(remote, source) {
            if (!isRosterRenegotiationSource(source) && source !== "manual") {
                deps.actions.ensure(remote, source);
                return;
            }
            schedule(remote, source);
        },

        notifyPairRosterUpdate(remote, source) {
            schedule(remote, source);
        },

        notifyJoinBatchIdle(completedPairId) {
            if (!completedPairId) return;
            const remote = deps.remoteForPairId(completedPairId);
            if (!remote) return;
            schedule(remote, "roster_kick");
        },

        dispose() {
            for (const remote of [...pending.keys()]) {
                cancelPending(remote);
            }
        },
    };
}
