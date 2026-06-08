import type { WebRtcSignalingClient } from "../lib/webrtc-signaling-client";
import type { RealtimeTransport } from "./l1-realtime-transport";
import { pairSessionId, parsePairSessionId } from "./pair-id";
import { EventBus } from "./event-bus";
import { recordTransportLifecycle } from "../lib/thread-lifecycle";
import type { Unsubscribe } from "./types";

type PairSignalingEvents = {
    pairJoined: (pairId: string) => void;
    pairSnapshot: (
        pairId: string,
        joined: readonly string[],
        pending: readonly string[],
        epoch: number,
    ) => void;
    remoteSignal: (
        pairId: string,
        from: string,
        kind: string,
        payload: unknown,
    ) => void;
    /** All queued/in-flight pair joins have received a snapshot (or gave up). */
    joinsIdle: () => void;
};

export interface PairSignaling {
    joinPair(local: string, remote: string): void;
    /** Track pair membership for welcome re-join without sending joinSession. */
    ensureActivePair(local: string, remote: string): void;
    leavePair(pairId: string, reason: string): void;
    signal(
        pairId: string,
        payload: Parameters<WebRtcSignalingClient["signal"]>[0],
    ): void;
    isJoined(pairId: string): boolean;
    /** True while pair joinSession work is still queued or awaiting snapshot. */
    hasPendingJoins(): boolean;
    /** True when the websocket is session-ready. */
    isRealtimeReady(pairId: string): boolean;
    /** Apply server roster — emits `pairJoined` when self joins. */
    applySessionSnapshot(
        pairId: string,
        joinedParticipants: readonly string[],
    ): void;
    on(
        event: keyof PairSignalingEvents,
        handler: PairSignalingEvents[keyof PairSignalingEvents],
    ): Unsubscribe;
    dispose(): void;
}

export type PairSignalingOptions = {
    localAccount: string;
    realtime: RealtimeTransport;
    signaling: WebRtcSignalingClient;
    /** Server roster gate — defer SDP until self appears in joinedParticipants. */
    isJoinedOnServer?: (pairId: string) => boolean;
    onServerJoined?: (pairId: string) => void;
    /** Delay between consecutive joinSession sends on the same socket. */
    joinStaggerMs?: number;
    /** Retry joinSession until a sessionSnapshot arrives. */
    joinRetryMs?: number;
};

export function createPairSignaling(
    opts: PairSignalingOptions,
): PairSignaling {
    const bus = new EventBus<PairSignalingEvents>();
    const activePairs = new Set<string>();
    const joinedPairs = new Set<string>();
    const serverJoined = new Map<string, boolean>();
    const awaitingSnapshot = new Set<string>();
    const joinQueue: string[] = [];
    let joinDrainTimer: ReturnType<typeof setTimeout> | null = null;
    let joinRetryTimer: ReturnType<typeof setInterval> | null = null;
    /** Pair id whose joinSession is currently in flight. */
    let inFlightJoin: string | null = null;

    const joinStaggerMs = opts.joinStaggerMs ?? 50;
    const joinRetryMs = opts.joinRetryMs ?? 2_000;
    const maxJoinRetries = 15;
    const joinRetryCounts = new Map<string, number>();

    const emitPairJoined = (pairId: string) => {
        joinedPairs.add(pairId);
        serverJoined.set(pairId, true);
        awaitingSnapshot.delete(pairId);
        joinRetryCounts.delete(pairId);
        opts.onServerJoined?.(pairId);
        recordTransportLifecycle("l2", "pair-joined", {
            pairId,
            localAccount: opts.localAccount,
        });
        bus.emit("pairJoined", pairId);
    };

    const markJoined = (pairId: string) => {
        emitPairJoined(pairId);
    };

    const stopJoinRetry = () => {
        if (joinRetryTimer == null) return;
        clearInterval(joinRetryTimer);
        joinRetryTimer = null;
    };

    const isWsReady = () => opts.realtime.isReady;

    const ensureJoinRetry = () => {
        if (joinRetryMs <= 0 || joinRetryTimer != null || awaitingSnapshot.size === 0) {
            return;
        }
        joinRetryTimer = setInterval(() => {
            for (const pairId of [...awaitingSnapshot]) {
                if (!joinedPairs.has(pairId)) {
                    const attempts = joinRetryCounts.get(pairId) ?? 0;
                    if (attempts >= maxJoinRetries) {
                        awaitingSnapshot.delete(pairId);
                        completeInFlightJoin(pairId);
                        continue;
                    }
                    joinRetryCounts.set(pairId, attempts + 1);
                    if (!isWsReady()) continue;
                    opts.signaling.joinSession(pairId);
                }
            }
            if (awaitingSnapshot.size === 0) {
                stopJoinRetry();
            }
        }, joinRetryMs);
    };

    const noteJoinSent = (pairId: string) => {
        awaitingSnapshot.add(pairId);
        ensureJoinRetry();
    };

    const hasInFlightJoin = () => inFlightJoin != null;

    const hasPendingJoins = () =>
        joinQueue.length > 0 ||
        hasInFlightJoin() ||
        awaitingSnapshot.size > 0;

    const maybeEmitJoinsIdle = () => {
        if (!hasPendingJoins()) {
            recordTransportLifecycle("l2", "joins-idle", {
                localAccount: opts.localAccount,
            });
            bus.emit("joinsIdle");
        }
    };

    const completeInFlightJoin = (pairId: string) => {
        if (inFlightJoin !== pairId) return;
        inFlightJoin = null;
        if (joinQueue.length > 0) {
            scheduleDrain(true);
            return;
        }
        maybeEmitJoinsIdle();
    };

    const scheduleDrain = (afterCompleted = false) => {
        if (joinDrainTimer != null) return;
        if (afterCompleted && joinStaggerMs > 0) {
            joinDrainTimer = setTimeout(() => {
                joinDrainTimer = null;
                drainNextJoin();
            }, joinStaggerMs);
            return;
        }
        drainNextJoin();
    };

    const drainNextJoin = () => {
        joinDrainTimer = null;
        if (joinQueue.length === 0) return;
        if (inFlightJoin != null) return;
        if (!isWsReady()) return;

        const pairId = joinQueue.shift()!;
        inFlightJoin = pairId;
        noteJoinSent(pairId);
        recordTransportLifecycle("l2", "join-sent", {
            pairId,
            localAccount: opts.localAccount,
        });
        opts.signaling.joinSession(pairId);

        if (joinQueue.length > 0) {
            scheduleDrain();
        }
    };

    let flushScheduled = false;
    const enqueueJoin = (pairId: string) => {
        if (!joinQueue.includes(pairId)) {
            joinQueue.push(pairId);
        }
        if (flushScheduled) return;
        flushScheduled = true;
        queueMicrotask(() => {
            flushScheduled = false;
            scheduleDrain();
        });
    };

    const rejoinAll = () => {
        if (joinDrainTimer != null) {
            clearTimeout(joinDrainTimer);
            joinDrainTimer = null;
        }
        flushScheduled = false;
        inFlightJoin = null;
        for (const pairId of activePairs) {
            if (!joinQueue.includes(pairId)) {
                joinQueue.push(pairId);
            }
        }
        if (joinQueue.length > 0) {
            scheduleDrain();
        }
    };

    const invalidateJoinState = () => {
        for (const pairId of activePairs) {
            joinedPairs.delete(pairId);
            serverJoined.set(pairId, false);
            awaitingSnapshot.delete(pairId);
            joinRetryCounts.delete(pairId);
            const idx = joinQueue.indexOf(pairId);
            if (idx >= 0) joinQueue.splice(idx, 1);
        }
        if (inFlightJoin != null) {
            inFlightJoin = null;
        }
        if (awaitingSnapshot.size === 0) {
            stopJoinRetry();
        }
    };

    const ensureActivePair = (local: string, remote: string) => {
        if (local === remote) return;
        const pairId = pairSessionId(local, remote);
        activePairs.add(pairId);
    };

    const unsubs: Array<() => void> = [
        opts.realtime.on("welcome", () => invalidateJoinState()),
        opts.realtime.on("ready", () => rejoinAll()),
    ];

    return {
        joinPair(local, remote) {
            const pairId = pairSessionId(local, remote);
            ensureActivePair(local, remote);
            recordTransportLifecycle("l2", "join-request", {
                pairId,
                local,
                remote,
                alreadyJoined: joinedPairs.has(pairId),
            });
            if (joinedPairs.has(pairId)) {
                return;
            }
            if (isWsReady()) {
                enqueueJoin(pairId);
            }
        },

        ensureActivePair,

        leavePair(pairId, reason) {
            activePairs.delete(pairId);
            joinedPairs.delete(pairId);
            serverJoined.delete(pairId);
            awaitingSnapshot.delete(pairId);
            const idx = joinQueue.indexOf(pairId);
            if (idx >= 0) joinQueue.splice(idx, 1);
            if (inFlightJoin === pairId) {
                inFlightJoin = null;
                scheduleDrain();
            }
            if (awaitingSnapshot.size === 0) {
                stopJoinRetry();
            }
            opts.signaling.leaveSession(pairId, reason);
        },

        signal(pairId, payload) {
            opts.signaling.signal(payload);
        },

        isJoined(pairId) {
            if (opts.isJoinedOnServer?.(pairId)) return true;
            return joinedPairs.has(pairId);
        },

        hasPendingJoins() {
            return hasPendingJoins();
        },

        isRealtimeReady(_pairId: string) {
            return isWsReady();
        },

        applySessionSnapshot(pairId, joinedParticipants) {
            const parsed = parsePairSessionId(pairId);
            const remote = parsed
                ? parsed[0] === opts.localAccount
                    ? parsed[1]
                    : parsed[0]
                : null;
            const selfOnRoster = joinedParticipants.includes(opts.localAccount);
            const remoteOnRoster =
                remote != null && joinedParticipants.includes(remote);

            if (!selfOnRoster) {
                joinedPairs.delete(pairId);
                serverJoined.set(pairId, false);
            }

            if (selfOnRoster && !serverJoined.get(pairId)) {
                serverJoined.set(pairId, true);
                opts.onServerJoined?.(pairId);
            }

            // Server acknowledged this pair join — drain the next queued pair
            // join on the same socket even if the remote is still pending.
            if (selfOnRoster) {
                completeInFlightJoin(pairId);
            }

            if (!remoteOnRoster) {
                if (remote) ensureActivePair(opts.localAccount, remote);
                return;
            }

            awaitingSnapshot.delete(pairId);
            if (awaitingSnapshot.size === 0) {
                stopJoinRetry();
            }
            if (remote) ensureActivePair(opts.localAccount, remote);
            if (selfOnRoster) {
                markJoined(pairId);
            }
            maybeEmitJoinsIdle();
        },

        on(event, handler) {
            return bus.on(event, handler as PairSignalingEvents[typeof event]);
        },

        dispose() {
            stopJoinRetry();
            if (joinDrainTimer != null) {
                clearTimeout(joinDrainTimer);
                joinDrainTimer = null;
            }
            for (const unsub of unsubs.splice(0)) {
                unsub();
            }
        },
    };
}

export type { PairSignalingEvents };

/** Apply server sessionSnapshot to pair join state (called from stack wiring). */
export function applyPairSessionSnapshot(
    signaling: PairSignaling,
    pairId: string,
    localAccount: string,
    joinedParticipants: readonly string[],
    pendingParticipants: readonly string[],
    epoch: number,
    onJoined: () => void,
): void {
    void pendingParticipants;
    const handler = signaling as PairSignaling & {
        __applySnapshot?: (
            pairId: string,
            joined: readonly string[],
            epoch: number,
        ) => void;
    };
    handler.__applySnapshot?.(pairId, joinedParticipants, epoch);
    if (joinedParticipants.includes(localAccount)) {
        onJoined();
    }
}
