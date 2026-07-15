import type { AvCallOrchestratorHost } from "./av-call-session-types";
import type { MeetPeerHandle } from "./meet-peer-handle";

import { createSharedMeetPeer } from "./shared-meet-peer";

export type MeetPeerFactoryHandlers = {
    onMediaConnected?: () => void;
    onLocalStream?: (stream: MediaStream | null) => void;
    onRemoteStream?: (stream: MediaStream | null) => void;
    onFailed?: (detail: string) => void;
    onTransportLost?: (detail: string) => void;
};

export type CreateMeetPeerParams = {
    host: AvCallOrchestratorHost;
    remoteAccount: string;
    avCallSessionId: string;
    selfAccount: string;
    isInitiator: boolean;
    wantVideo: boolean;
    wantAudio: boolean;
    sharedLocalStream?: MediaStream | null;
    handlers?: MeetPeerFactoryHandlers;
};

/**
 * One-PC invariant: Meet always attaches to the shared pair PC via
 * DeliveryFabric (or PeerMediaPort). No standalone MeetWebRtcPeer fallback.
 */
export function createMeetPeerForRemote(
    params: CreateMeetPeerParams,
): MeetPeerHandle {
    const fabric = params.host.getDeliveryFabric?.() ?? null;
    if (fabric) {
        return fabric.startPeerMedia({
            remoteAccount: params.remoteAccount,
            avCallSessionId: params.avCallSessionId,
            wantVideo: params.wantVideo,
            wantAudio: params.wantAudio,
            sharedLocalStream: params.sharedLocalStream,
            ...params.handlers,
        });
    }

    const media = params.host.getPeerMediaPort?.() ?? null;
    if (media) {
        return createSharedMeetPeer(media, {
            remoteAccount: params.remoteAccount,
            avCallSessionId: params.avCallSessionId,
            wantVideo: params.wantVideo,
            wantAudio: params.wantAudio,
            sharedLocalStream: params.sharedLocalStream,
            ...params.handlers,
        });
    }

    throw new Error(
        "DeliveryFabric (or PeerMediaPort) required for Meet — shared pair PC only",
    );
}

export function shouldReuseMeetPeer(
    host: AvCallOrchestratorHost,
    existing: MeetPeerHandle | null | undefined,
    avCallSessionId: string,
): boolean {
    if (!existing || existing.isDisposed) return false;
    if (host.usesSharedTransport?.()) return true;
    return existing.sessionId === avCallSessionId;
}
