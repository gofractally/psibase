import type { WebRtcSignalingClient } from "../lib/webrtc-signaling-client";
import type { RealtimeTransport } from "./l1-realtime-transport";
import { pairSessionId } from "./pair-id";
import { EventBus } from "./event-bus";
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
};

export interface PairSignaling {
    joinPair(local: string, remote: string): void;
    leavePair(pairId: string, reason: string): void;
    signal(
        pairId: string,
        payload: Parameters<WebRtcSignalingClient["signal"]>[0],
    ): void;
    isJoined(pairId: string): boolean;
    /** Apply server roster — emits `pairJoined` when self joins. */
    applySessionSnapshot(
        pairId: string,
        joinedParticipants: readonly string[],
    ): void;
    on(
        event: keyof PairSignalingEvents,
        handler: PairSignalingEvents[keyof PairSignalingEvents],
    ): Unsubscribe;
}

export type PairSignalingOptions = {
    localAccount: string;
    realtime: RealtimeTransport;
    signaling: WebRtcSignalingClient;
    /** Server roster gate — defer SDP until self appears in joinedParticipants. */
    isJoinedOnServer?: (pairId: string) => boolean;
    onServerJoined?: (pairId: string) => void;
};

export function createPairSignaling(
    opts: PairSignalingOptions,
): PairSignaling {
    const bus = new EventBus<PairSignalingEvents>();
    const activePairs = new Set<string>();
    const joinedPairs = new Set<string>();
    const serverJoined = new Map<string, boolean>();

    const markJoined = (pairId: string) => {
        joinedPairs.add(pairId);
        serverJoined.set(pairId, true);
        opts.onServerJoined?.(pairId);
        bus.emit("pairJoined", pairId);
    };

    const rejoinAll = () => {
        for (const pairId of activePairs) {
            opts.signaling.joinSession(pairId);
        }
    };

    opts.realtime.on("ready", rejoinAll);
    opts.realtime.on("welcome", () => {
        joinedPairs.clear();
        for (const pairId of activePairs) {
            serverJoined.set(pairId, false);
        }
        rejoinAll();
    });

    return {
        joinPair(local, remote) {
            const pairId = pairSessionId(local, remote);
            if (activePairs.has(pairId)) return;
            activePairs.add(pairId);
            if (opts.realtime.isReady) {
                opts.signaling.joinSession(pairId);
            }
        },

        leavePair(pairId, reason) {
            activePairs.delete(pairId);
            joinedPairs.delete(pairId);
            serverJoined.delete(pairId);
            opts.signaling.leaveSession(pairId, reason);
        },

        signal(pairId, payload) {
            opts.signaling.signal(payload);
            void pairId;
        },

        isJoined(pairId) {
            if (opts.isJoinedOnServer?.(pairId)) return true;
            return joinedPairs.has(pairId);
        },

        applySessionSnapshot(pairId, joinedParticipants) {
            if (joinedParticipants.includes(opts.localAccount)) {
                markJoined(pairId);
            }
        },

        on(event, handler) {
            return bus.on(event, handler as PairSignalingEvents[typeof event]);
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
