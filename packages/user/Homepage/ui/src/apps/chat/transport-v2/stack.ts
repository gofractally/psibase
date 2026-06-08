import type { RealtimeClient } from "../lib/realtime-client";
import type { IceServerConfig } from "../lib/protocol";
import { WebRtcSignalingClient } from "../lib/webrtc-signaling-client";
import { createRealtimeTransport } from "./l1-realtime-transport";
import { createPairSignaling } from "./l2-pair-signaling";
import { createPeerTransportRegistry } from "./l3-peer-registry";
import {
    createMessagingService,
    type MessagingService,
} from "./l4-messaging-service";
import { pairSessionId, parsePairSessionId } from "./pair-id";

export type ChatTransportStack = {
    messaging: MessagingService;
    pairSignaling: ReturnType<typeof createPairSignaling>;
    peerRegistry: ReturnType<typeof createPeerTransportRegistry>;
    realtime: ReturnType<typeof createRealtimeTransport>;
    signaling: WebRtcSignalingClient;
    wireRealtimeHandlers(handlers: {
        sessionSnapshot?: (
            sessionId: string,
            joined: readonly string[],
            pending: readonly string[],
            epoch: number,
        ) => void;
        signal?: (
            sessionId: string,
            from: string,
            kind: string,
            payload: unknown,
        ) => void;
    }): void;
    dispose(): void;
};

export type ChatTransportStackOptions = {
    localAccount: string;
    chainId: string;
    realtimeClient: RealtimeClient;
    /** Second websocket for an additional pair session (group mesh). */
    auxiliaryRealtimeClient?: RealtimeClient;
    iceServers: IceServerConfig[] | null;
    isSpaceMember?: (spaceUuid: string, account: string) => boolean;
    onInboundBytes?: (remote: string, bytes: Uint8Array) => void;
    /** Delay between consecutive pair joinSession sends on the same channel. */
    pairJoinStaggerMs?: number;
    /** Retry pair joinSession until snapshot (default 2000ms; 0 disables). */
    pairJoinRetryMs?: number;
};

export function createChatTransportStack(
    opts: ChatTransportStackOptions,
): ChatTransportStack {
    const realtime = createRealtimeTransport(opts.realtimeClient);
    const auxiliaryRealtime = opts.auxiliaryRealtimeClient
        ? createRealtimeTransport(opts.auxiliaryRealtimeClient)
        : undefined;
    const signaling = new WebRtcSignalingClient(opts.realtimeClient);
    const auxiliarySignaling = opts.auxiliaryRealtimeClient
        ? new WebRtcSignalingClient(opts.auxiliaryRealtimeClient)
        : undefined;
    const joinedPairs = new Map<string, boolean>();

    const bindSignalingGate = (sig: WebRtcSignalingClient) => {
        sig.bindSessionJoinedGate(
            (sessionId) => joinedPairs.get(sessionId) === true,
        );
    };
    bindSignalingGate(signaling);
    if (auxiliarySignaling) bindSignalingGate(auxiliarySignaling);

    /** Latest applied sessionSnapshot epoch per pair (dual WS can deliver out of order). */
    const pairSnapshotEpoch = new Map<string, number>();

    const pairSignaling = createPairSignaling({
        localAccount: opts.localAccount,
        realtime,
        signaling,
        auxiliaryRealtime,
        auxiliarySignaling,
        isJoinedOnServer: (pairId) => joinedPairs.get(pairId) === true,
        onServerJoined: (pairId) => {
            joinedPairs.set(pairId, true);
            signaling.flushDeferredSignals(pairId);
            auxiliarySignaling?.flushDeferredSignals(pairId);
        },
        joinStaggerMs: opts.pairJoinStaggerMs,
        joinRetryMs: opts.pairJoinRetryMs,
    });

    const resetPairRosterForChannel = (channel: "primary" | "auxiliary") => {
        for (const pairId of [...pairSnapshotEpoch.keys()]) {
            const assigned = pairSignaling.sessionChannel(pairId);
            const onChannel =
                assigned === channel ||
                (assigned === undefined && channel === "primary");
            if (!onChannel) continue;
            pairSnapshotEpoch.delete(pairId);
            joinedPairs.delete(pairId);
        }
    };

    const stackUnsubs: Array<() => void> = [];
    stackUnsubs.push(
        realtime.on("welcome", () => resetPairRosterForChannel("primary")),
    );
    if (auxiliaryRealtime) {
        stackUnsubs.push(
            auxiliaryRealtime.on("welcome", () =>
                resetPairRosterForChannel("auxiliary"),
            ),
        );
    }

    const messagingRef: { current: MessagingService | null } = { current: null };

    const peerRegistry = createPeerTransportRegistry({
        localAccount: opts.localAccount,
        realtime,
        auxiliaryRealtime,
        pairSignaling,
        signaling,
        iceServers: opts.iceServers,
        onInboundBytes: (remote, bytes) => {
            if (opts.onInboundBytes) {
                opts.onInboundBytes(remote, bytes);
                return;
            }
            const raw = new TextDecoder().decode(bytes);
            const svc = messagingRef.current as MessagingService & {
                handleWireFromRemote?: (remote: string, raw: string) => void;
            };
            svc.handleWireFromRemote?.(remote, raw);
        },
    });

    const messaging = createMessagingService({
        localAccount: opts.localAccount,
        chainId: opts.chainId,
        realtime,
        peerRegistry,
        isSpaceMember: opts.isSpaceMember,
    });
    messagingRef.current = messaging;

    const kickFromPairRoster = (
        sessionId: string,
        joined: readonly string[],
    ) => {
        const parsed = parsePairSessionId(sessionId);
        if (!parsed) return;
        const remote =
            parsed[0] === opts.localAccount ? parsed[1] : parsed[0];
        if (!joined.includes(remote)) return;
        if (joined.includes(opts.localAccount)) {
            if (pairSignaling.hasPendingJoins()) return;
            peerRegistry.kickNegotiation(remote);
            return;
        }
        if (pairSignaling.hasPendingJoins()) return;
        void peerRegistry.ensure(remote, "peer_joined");
    };

    const kickAllJoinedPeers = () => {
        if (pairSignaling.hasPendingJoins()) return;
        for (const [pairId, joined] of joinedPairs) {
            if (!joined) continue;
            const parsed = parsePairSessionId(pairId);
            if (!parsed) continue;
            const remote =
                parsed[0] === opts.localAccount ? parsed[1] : parsed[0];
            peerRegistry.kickNegotiation(remote);
        }
    };

    stackUnsubs.push(pairSignaling.on("joinsIdle", kickAllJoinedPeers));

    const ownsPairSession = (
        sessionId: string,
        channel: "primary" | "auxiliary",
    ): boolean => {
        if (!sessionId.startsWith("wrtc:pair:")) return false;
        const assigned = pairSignaling.sessionChannel(sessionId);
        if (!assigned) return channel === "primary";
        return assigned === channel;
    };

    const wirePairRealtimeHandlers = (
        channel: "primary" | "auxiliary",
        handlers: {
        sessionSnapshot?: (
            sessionId: string,
            joined: readonly string[],
            pending: readonly string[],
            epoch: number,
        ) => void;
        signal?: (
            sessionId: string,
            from: string,
            kind: string,
            payload: unknown,
        ) => void;
        }) => ({
        sessionSnapshot: (frame: {
            sessionId: string;
            joinedParticipants: readonly string[];
            pendingParticipants: readonly string[];
            epoch: number;
        }) => {
            if (!ownsPairSession(frame.sessionId, channel)) return;
            const prevEpoch = pairSnapshotEpoch.get(frame.sessionId) ?? 0;
            if (frame.epoch < prevEpoch) {
                return;
            }
            pairSnapshotEpoch.set(frame.sessionId, frame.epoch);
            joinedPairs.set(
                frame.sessionId,
                frame.joinedParticipants.includes(opts.localAccount),
            );
            pairSignaling.applySessionSnapshot(
                frame.sessionId,
                frame.joinedParticipants,
            );
            if (frame.joinedParticipants.includes(opts.localAccount)) {
                signaling.flushDeferredSignals(frame.sessionId);
                auxiliarySignaling?.flushDeferredSignals(frame.sessionId);
            }
            kickFromPairRoster(
                frame.sessionId,
                frame.joinedParticipants,
            );
            handlers.sessionSnapshot?.(
                frame.sessionId,
                frame.joinedParticipants,
                frame.pendingParticipants,
                frame.epoch,
            );
        },
        participantJoined: (frame: {
            sessionId: string;
            participant: string;
        }) => {
            if (!ownsPairSession(frame.sessionId, channel)) return;
            if (pairSignaling.hasPendingJoins()) return;
            const remote = frame.participant;
            if (remote === opts.localAccount) return;
            void peerRegistry.ensure(remote, "peer_joined");
        },
        signal: (frame: {
            sessionId: string;
            from: string;
            kind: string;
            sdp?: string;
            candidate?: string;
            sdpMid?: string | null;
            sdpMLineIndex?: number | null;
        }) => {
            if (!ownsPairSession(frame.sessionId, channel)) return;
            const parsed = parsePairSessionId(frame.sessionId);
            if (!parsed) return;
            const remote =
                parsed[0] === opts.localAccount ? parsed[1] : parsed[0];
            void peerRegistry.handleRemoteSignal(remote, {
                from: frame.from,
                kind: frame.kind as "offer" | "answer" | "candidate",
                sdp: frame.sdp,
                candidate: frame.candidate,
                sdpMid: frame.sdpMid ?? undefined,
                sdpMLineIndex: frame.sdpMLineIndex ?? undefined,
            });
            handlers.signal?.(
                frame.sessionId,
                frame.from,
                frame.kind,
                frame,
            );
        },
    });

    let unregisterPairHandlers: (() => void) | null = null;

    const wireRealtimeHandlers = (handlers: {
        sessionSnapshot?: (
            sessionId: string,
            joined: readonly string[],
            pending: readonly string[],
            epoch: number,
        ) => void;
        signal?: (
            sessionId: string,
            from: string,
            kind: string,
            payload: unknown,
        ) => void;
    }) => {
        unregisterPairHandlers?.();
        const unregPrimary = opts.realtimeClient.registerHandlers(
            wirePairRealtimeHandlers("primary", handlers),
        );
        const unregAux = opts.auxiliaryRealtimeClient
            ? opts.auxiliaryRealtimeClient.registerHandlers(
                  wirePairRealtimeHandlers("auxiliary", handlers),
              )
            : null;
        unregisterPairHandlers = () => {
            unregPrimary();
            unregAux?.();
        };
    };

    return {
        messaging,
        pairSignaling,
        peerRegistry,
        realtime,
        signaling,
        wireRealtimeHandlers,
        dispose() {
            unregisterPairHandlers?.();
            unregisterPairHandlers = null;
            for (const unsub of stackUnsubs.splice(0)) {
                unsub();
            }
            pairSignaling.dispose();
            realtime.dispose();
            auxiliaryRealtime?.dispose();
        },
    };
}

export { pairSessionId };
