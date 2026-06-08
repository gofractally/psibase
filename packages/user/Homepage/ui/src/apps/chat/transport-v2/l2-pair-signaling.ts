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
    /** Which websocket owns signaling for this pair (undefined until first joinPair). */
    sessionChannel(pairId: string): PairChannel | undefined;
    /** True when the websocket assigned to this pair is session-ready. */
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

type PairChannel = "primary" | "auxiliary";

export type PairSignalingOptions = {
    localAccount: string;
    realtime: RealtimeTransport;
    signaling: WebRtcSignalingClient;
    /** Second websocket — one pair join per socket (server drops 2nd join on same ws). */
    auxiliaryRealtime?: RealtimeTransport;
    auxiliarySignaling?: WebRtcSignalingClient;
    /** Server roster gate — defer SDP until self appears in joinedParticipants. */
    isJoinedOnServer?: (pairId: string) => boolean;
    onServerJoined?: (pairId: string) => void;
    /** Delay between consecutive joinSession sends on the same channel. */
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
    /** Pair id whose joinSession is in flight per websocket channel. */
    const inFlightByChannel = new Map<PairChannel, string | null>([
        ["primary", null],
        ["auxiliary", null],
    ]);
    const pairChannel = new Map<string, PairChannel>();

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
                    if (!isChannelReady(channelFor(pairId))) continue;
                    signalingFor(pairId).joinSession(pairId);
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

    const hasInFlightJoin = () =>
        inFlightByChannel.get("primary") != null ||
        inFlightByChannel.get("auxiliary") != null;

    const hasPendingJoins = () =>
        joinQueue.length > 0 ||
        hasInFlightJoin() ||
        awaitingSnapshot.size > 0;

    const channelFor = (pairId: string): PairChannel => {
        const existing = pairChannel.get(pairId);
        if (existing) return existing;
        const primaryTaken = [...pairChannel.values()].includes("primary");
        const useAuxiliary = opts.auxiliarySignaling != null && primaryTaken;
        const channel: PairChannel = useAuxiliary ? "auxiliary" : "primary";
        pairChannel.set(pairId, channel);
        return channel;
    };

    const signalingFor = (pairId: string): WebRtcSignalingClient =>
        channelFor(pairId) === "auxiliary" && opts.auxiliarySignaling
            ? opts.auxiliarySignaling
            : opts.signaling;

    const realtimeFor = (pairId: string): RealtimeTransport =>
        channelFor(pairId) === "auxiliary" && opts.auxiliaryRealtime
            ? opts.auxiliaryRealtime
            : opts.realtime;

    const isChannelReady = (channel: PairChannel) =>
        channel === "auxiliary"
            ? (opts.auxiliaryRealtime?.isReady ?? false)
            : opts.realtime.isReady;

    const maybeEmitJoinsIdle = () => {
        if (!hasPendingJoins()) {
            recordTransportLifecycle("l2", "joins-idle", {
                localAccount: opts.localAccount,
            });
            bus.emit("joinsIdle");
        }
    };

    const completeInFlightJoin = (pairId: string) => {
        const channel = pairChannel.get(pairId);
        if (!channel || inFlightByChannel.get(channel) !== pairId) return;
        inFlightByChannel.set(channel, null);
        if (joinQueue.length > 0) {
            scheduleDrain(true);
            return;
        }
        if (!hasInFlightJoin()) {
            maybeEmitJoinsIdle();
        }
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

        let dispatched = false;
        for (let i = 0; i < joinQueue.length; i++) {
            const pairId = joinQueue[i]!;
            const channel = channelFor(pairId);
            if (inFlightByChannel.get(channel) != null) continue;
            if (!isChannelReady(channel)) continue;
            joinQueue.splice(i, 1);
            inFlightByChannel.set(channel, pairId);
            noteJoinSent(pairId);
            recordTransportLifecycle("l2", "join-sent", {
                pairId,
                channel,
                localAccount: opts.localAccount,
            });
            signalingFor(pairId).joinSession(pairId);
            dispatched = true;
            break;
        }
        if (dispatched && joinQueue.length > 0) {
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

    const rejoinAllForChannel = (channel: PairChannel) => {
        if (joinDrainTimer != null) {
            clearTimeout(joinDrainTimer);
            joinDrainTimer = null;
        }
        flushScheduled = false;
        for (const pairId of activePairs) {
            if (channelFor(pairId) !== channel) continue;
            inFlightByChannel.set(channel, null);
            if (!joinQueue.includes(pairId)) {
                joinQueue.push(pairId);
            }
        }
        if (joinQueue.length > 0) {
            scheduleDrain();
        }
    };

    const invalidateJoinStateForChannel = (channel: PairChannel) => {
        for (const pairId of activePairs) {
            if (channelFor(pairId) !== channel) continue;
            joinedPairs.delete(pairId);
            serverJoined.set(pairId, false);
            awaitingSnapshot.delete(pairId);
            joinRetryCounts.delete(pairId);
            if (inFlightByChannel.get(channel) === pairId) {
                inFlightByChannel.set(channel, null);
            }
            const idx = joinQueue.indexOf(pairId);
            if (idx >= 0) joinQueue.splice(idx, 1);
        }
        if (awaitingSnapshot.size === 0) {
            stopJoinRetry();
        }
    };

    const ensureActivePair = (local: string, remote: string) => {
        if (local === remote) return;
        const pairId = pairSessionId(local, remote);
        activePairs.add(pairId);
        channelFor(pairId);
    };

    const unsubs: Array<() => void> = [
        opts.realtime.on("welcome", () =>
            invalidateJoinStateForChannel("primary"),
        ),
        opts.realtime.on("ready", () => rejoinAllForChannel("primary")),
    ];
    if (opts.auxiliaryRealtime) {
        unsubs.push(
            opts.auxiliaryRealtime.on("welcome", () =>
                invalidateJoinStateForChannel("auxiliary"),
            ),
            opts.auxiliaryRealtime.on("ready", () =>
                rejoinAllForChannel("auxiliary"),
            ),
        );
    }

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
            if (isChannelReady(channelFor(pairId))) {
                enqueueJoin(pairId);
            }
        },

        ensureActivePair,

        leavePair(pairId, reason) {
            activePairs.delete(pairId);
            joinedPairs.delete(pairId);
            serverJoined.delete(pairId);
            awaitingSnapshot.delete(pairId);
            const channel = pairChannel.get(pairId);
            pairChannel.delete(pairId);
            const idx = joinQueue.indexOf(pairId);
            if (idx >= 0) joinQueue.splice(idx, 1);
            if (channel && inFlightByChannel.get(channel) === pairId) {
                inFlightByChannel.set(channel, null);
                scheduleDrain();
            }
            if (awaitingSnapshot.size === 0) {
                stopJoinRetry();
            }
            signalingFor(pairId).leaveSession(pairId, reason);
        },

        signal(pairId, payload) {
            signalingFor(pairId).signal(payload);
        },

        isJoined(pairId) {
            if (opts.isJoinedOnServer?.(pairId)) return true;
            return joinedPairs.has(pairId);
        },

        hasPendingJoins() {
            return hasPendingJoins();
        },

        sessionChannel(pairId: string) {
            return pairChannel.get(pairId);
        },

        isRealtimeReady(pairId: string) {
            return isChannelReady(channelFor(pairId));
        },

        applySessionSnapshot(pairId, joinedParticipants) {
            awaitingSnapshot.delete(pairId);
            completeInFlightJoin(pairId);
            if (awaitingSnapshot.size === 0) {
                stopJoinRetry();
            }
            const parsed = parsePairSessionId(pairId);
            if (parsed) {
                const remote =
                    parsed[0] === opts.localAccount ? parsed[1] : parsed[0];
                ensureActivePair(opts.localAccount, remote);
            }
            if (joinedParticipants.includes(opts.localAccount)) {
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
