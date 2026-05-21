import { MeetWebRtcPeer } from "./meet-webrtc-peer";
import type { MeetPeerHandle } from "./meet-peer-handle";
import type { AvCallOrchestratorHost } from "./av-call-session-types";
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

/** Same PC as chat when shared registry is wired; else standalone MeetWebRtcPeer. */
export function createMeetPeerForRemote(
    params: CreateMeetPeerParams,
): MeetPeerHandle {
    const registry = params.host.getSharedPeerRegistry?.() ?? null;
    if (registry) {
        return createSharedMeetPeer(registry, {
            remoteAccount: params.remoteAccount,
            avCallSessionId: params.avCallSessionId,
            wantVideo: params.wantVideo,
            wantAudio: params.wantAudio,
            sharedLocalStream: params.sharedLocalStream,
            ...params.handlers,
        });
    }

    const signaling = params.host.getSignaling();
    if (!signaling) {
        throw new Error("WebRTC signaling not ready");
    }

    return new MeetWebRtcPeer({
        sessionId: params.avCallSessionId,
        selfAccount: params.selfAccount,
        peerAccount: params.remoteAccount,
        iceServers: params.host.getIceServers(),
        signaling,
        isInitiator: params.isInitiator,
        wantVideo: params.wantVideo,
        wantAudio: params.wantAudio,
        sharedLocalStream: params.sharedLocalStream,
        handlers: params.handlers,
    });
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
