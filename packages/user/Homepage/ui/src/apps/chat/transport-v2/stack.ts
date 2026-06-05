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
};

export type ChatTransportStackOptions = {
    localAccount: string;
    chainId: string;
    realtimeClient: RealtimeClient;
    iceServers: IceServerConfig[] | null;
    isSpaceMember?: (spaceUuid: string, account: string) => boolean;
    onInboundBytes?: (remote: string, bytes: Uint8Array) => void;
};

export function createChatTransportStack(
    opts: ChatTransportStackOptions,
): ChatTransportStack {
    const realtime = createRealtimeTransport(opts.realtimeClient);
    const signaling = new WebRtcSignalingClient(opts.realtimeClient);
    const joinedPairs = new Map<string, boolean>();

    signaling.bindSessionJoinedGate((sessionId) => joinedPairs.get(sessionId) === true);

    const pairSignaling = createPairSignaling({
        localAccount: opts.localAccount,
        realtime,
        signaling,
        isJoinedOnServer: (pairId) => joinedPairs.get(pairId) === true,
        onServerJoined: (pairId) => {
            joinedPairs.set(pairId, true);
            signaling.flushDeferredSignals(pairId);
        },
    });

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
    });

    const messaging = createMessagingService({
        localAccount: opts.localAccount,
        chainId: opts.chainId,
        realtime,
        peerRegistry,
        isSpaceMember: opts.isSpaceMember,
    });
    messagingRef.current = messaging;

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
        opts.realtimeClient.registerHandlers({
            sessionSnapshot: (frame) => {
                if (!frame.sessionId.startsWith("wrtc:pair:")) return;
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
                handlers.sessionSnapshot?.(
                    frame.sessionId,
                    frame.joinedParticipants,
                    frame.pendingParticipants,
                    frame.epoch,
                );
            },
            signal: (frame) => {
                if (!frame.sessionId.startsWith("wrtc:pair:")) return;
                const parsed = parsePairSessionId(frame.sessionId);
                if (!parsed) return;
                const remote =
                    parsed[0] === opts.localAccount ? parsed[1] : parsed[0];
                void peerRegistry.handleRemoteSignal(remote, {
                    from: frame.from,
                    kind: frame.kind as "offer" | "answer" | "candidate",
                    sdp: frame.sdp,
                    candidate: frame.candidate,
                    sdpMid: frame.sdpMid,
                    sdpMLineIndex: frame.sdpMLineIndex,
                });
                handlers.signal?.(
                    frame.sessionId,
                    frame.from,
                    frame.kind,
                    frame,
                );
            },
        });
    };

    return {
        messaging,
        pairSignaling,
        peerRegistry,
        realtime,
        signaling,
        wireRealtimeHandlers,
    };
}

export { pairSessionId };
