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
import {
    createRosterRenegotiationCoordinator,
    type RosterRenegotiationCoordinator,
} from "./roster-renegotiation-coordinator";
import type { EnsureReason } from "./types";

export type ChatTransportStack = {
    messaging: MessagingService;
    pairSignaling: ReturnType<typeof createPairSignaling>;
    peerRegistry: ReturnType<typeof createPeerTransportRegistry>;
    rosterCoordinator: RosterRenegotiationCoordinator;
    realtime: ReturnType<typeof createRealtimeTransport>;
    signaling: WebRtcSignalingClient;
    notifyRemoteReachable: (remote: string, source: EnsureReason) => void;
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
    iceServers: IceServerConfig[] | null;
    isSpaceMember?: (spaceUuid: string, account: string) => boolean;
    onInboundBytes?: (remote: string, bytes: Uint8Array) => void;
    onSpaceMembershipHint?: (remote: string) => void;
    /** Delay between consecutive pair joinSession sends on the same socket. */
    pairJoinStaggerMs?: number;
    /** Retry pair joinSession until snapshot (default 2000ms; 0 disables). */
    pairJoinRetryMs?: number;
};

export function createChatTransportStack(
    opts: ChatTransportStackOptions,
): ChatTransportStack {
    const realtime = createRealtimeTransport(opts.realtimeClient);
    const signaling = new WebRtcSignalingClient(opts.realtimeClient);
    const joinedPairs = new Map<string, boolean>();

    signaling.bindSessionJoinedGate(
        (sessionId) => joinedPairs.get(sessionId) === true,
    );

    /** Latest applied sessionSnapshot epoch per pair (out-of-order delivery). */
    const pairSnapshotEpoch = new Map<string, number>();

    const pairSignaling = createPairSignaling({
        localAccount: opts.localAccount,
        realtime,
        signaling,
        isJoinedOnServer: (pairId) => joinedPairs.get(pairId) === true,
        onServerJoined: (pairId) => {
            joinedPairs.set(pairId, true);
            signaling.flushDeferredSignals(pairId);
        },
        joinStaggerMs: opts.pairJoinStaggerMs,
        joinRetryMs: opts.pairJoinRetryMs,
    });

    const resetPairRoster = () => {
        pairSnapshotEpoch.clear();
        joinedPairs.clear();
    };

    const stackUnsubs: Array<() => void> = [];
    stackUnsubs.push(realtime.on("welcome", () => resetPairRoster()));

    const messagingRef: { current: MessagingService | null } = { current: null };

    const peerRegistry = createPeerTransportRegistry({
        localAccount: opts.localAccount,
        realtime,
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
        onSpaceMembershipHint: opts.onSpaceMembershipHint,
    });

    const rosterCoordinator = createRosterRenegotiationCoordinator({
        localAccount: opts.localAccount,
        pairIdForRemote: (remote) =>
            pairSessionId(opts.localAccount, remote),
        remoteForPairId: (pairId) => {
            const parsed = parsePairSessionId(pairId);
            if (!parsed) return null;
            return parsed[0] === opts.localAccount ? parsed[1] : parsed[0];
        },
        getSnapshot: (remote) => peerRegistry.getRosterSnapshot(remote),
        actions: {
            ensure: (remote, reason) => {
                void peerRegistry.ensure(remote, reason);
            },
            resendOffer: (remote) => {
                peerRegistry.resendOffer(remote);
            },
            retriggerHandshake: (remote) => {
                peerRegistry.retriggerHandshake(remote);
            },
            recoverPeer: (remote, reason) => {
                peerRegistry.recoverPeer(remote, reason);
            },
        },
    });

    stackUnsubs.push(
        pairSignaling.on("joinsIdle", (completedPairId?: string) => {
            rosterCoordinator.notifyJoinBatchIdle(completedPairId);
        }),
    );

    const messaging = createMessagingService({
        localAccount: opts.localAccount,
        chainId: opts.chainId,
        realtime,
        peerRegistry,
        isSpaceMember: opts.isSpaceMember,
    });
    messagingRef.current = messaging;

    const remoteFromSession = (sessionId: string): string | null => {
        const parsed = parsePairSessionId(sessionId);
        if (!parsed) return null;
        return parsed[0] === opts.localAccount ? parsed[1] : parsed[0];
    };

    const notifyRemoteFromRoster = (
        sessionId: string,
        joined: readonly string[],
        source: EnsureReason,
    ) => {
        const remote = remoteFromSession(sessionId);
        if (!remote) return;
        if (!joined.includes(remote)) return;
        if (joined.includes(opts.localAccount)) {
            if (pairSignaling.hasPendingJoins()) return;
            const state = peerRegistry.getState(remote);
            if (state === "joining_pair") return;
            rosterCoordinator.notifyPairRosterUpdate(remote, source);
            return;
        }
        if (pairSignaling.hasPendingJoins()) return;
        void peerRegistry.ensure(remote, "peer_joined");
    };

    const isPairSession = (sessionId: string) =>
        sessionId.startsWith("wrtc:pair:");

    const wirePairRealtimeHandlers = (handlers: {
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
            if (!isPairSession(frame.sessionId)) return;
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
            }
            notifyRemoteFromRoster(
                frame.sessionId,
                frame.joinedParticipants,
                "roster_kick",
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
            if (!isPairSession(frame.sessionId)) return;
            if (pairSignaling.hasPendingJoins()) return;
            const remote = frame.participant;
            if (remote === opts.localAccount) return;
            rosterCoordinator.notifyPairRosterUpdate(remote, "peer_joined");
        },
        transportLost: (frame: {
            sessionId: string;
            participant: string;
        }) => {
            if (!isPairSession(frame.sessionId)) return;
            const remote = remoteFromSession(frame.sessionId);
            if (!remote || frame.participant !== remote) return;
            const state = peerRegistry.getState(remote);
            if (state === "absent" || state === "disposing") return;
            peerRegistry.recoverPeer(remote, "signaling_transport_lost");
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
            if (!isPairSession(frame.sessionId)) return;
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
        unregisterPairHandlers = opts.realtimeClient.registerHandlers(
            wirePairRealtimeHandlers(handlers),
        );
    };

    return {
        messaging,
        pairSignaling,
        peerRegistry,
        rosterCoordinator,
        realtime,
        signaling,
        notifyRemoteReachable: (remote, source) => {
            rosterCoordinator.notifyRemoteReachable(remote, source);
        },
        wireRealtimeHandlers,
        dispose() {
            rosterCoordinator.dispose();
            unregisterPairHandlers?.();
            unregisterPairHandlers = null;
            for (const unsub of stackUnsubs.splice(0)) {
                unsub();
            }
            pairSignaling.dispose();
            realtime.dispose();
        },
    };
}

export { pairSessionId };
