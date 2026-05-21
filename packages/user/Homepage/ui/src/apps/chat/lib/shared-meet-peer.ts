import type { ChatDataWebRtcPeer } from "./chat-data-webrtc-peer";
import type { MeetPeerHandle } from "./meet-peer-handle";
import type { PeerTransportRegistry } from "../transport-v2/l3-peer-registry";

export type SharedMeetPeerOptions = {
    remoteAccount: string;
    /** Objective av-call session id (timeline / invites); not used for WebRTC SDP. */
    avCallSessionId: string;
    wantVideo: boolean;
    wantAudio: boolean;
    sharedLocalStream?: MediaStream | null;
    onMediaConnected?: () => void;
    onLocalStream?: (stream: MediaStream | null) => void;
    onRemoteStream?: (stream: MediaStream | null) => void;
    onFailed?: (detail: string) => void;
    onTransportLost?: (detail: string) => void;
};

/**
 * Meet on the existing chat-data pair PC (architecture: same PC per remote).
 * WebRTC SDP flows on the pair session via {@link PeerTransportRegistry}.
 */
export class SharedMeetPeer implements MeetPeerHandle {
    readonly sessionId: string;

    private chatPeer: ChatDataWebRtcPeer | null = null;

    private disposed = false;

    constructor(
        private readonly registry: PeerTransportRegistry,
        private readonly opts: SharedMeetPeerOptions,
    ) {
        this.sessionId = opts.avCallSessionId;
    }

    get isMediaConnected(): boolean {
        return this.chatPeer?.isMediaConnected ?? false;
    }

    get isDisposed(): boolean {
        return this.disposed;
    }

    async start(): Promise<void> {
        if (this.disposed) return;
        await this.registry.ensure(this.opts.remoteAccount, "meet_start");
        const peer = this.registry.getChatPeer(this.opts.remoteAccount);
        if (!peer || this.disposed) {
            this.opts.onFailed?.("Shared pair PC not ready for Meet");
            return;
        }
        this.chatPeer = peer;
        this.registry.holdMeet(this.opts.remoteAccount);
        try {
            await peer.startMeetMedia({
                wantVideo: this.opts.wantVideo,
                wantAudio: this.opts.wantAudio,
                sharedLocalStream: this.opts.sharedLocalStream,
                onMediaConnected: () => this.opts.onMediaConnected?.(),
                onLocalStream: (s) => this.opts.onLocalStream?.(s),
                onRemoteStream: (s) => this.opts.onRemoteStream?.(s),
                onFailed: (d) => this.opts.onFailed?.(d),
                onTransportLost: (d) => this.opts.onTransportLost?.(d),
            });
        } catch (e) {
            this.registry.releaseMeet(this.opts.remoteAccount);
            const detail =
                e instanceof Error ? e.message : "Could not start Meet media";
            this.opts.onFailed?.(detail);
            throw e;
        }
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.chatPeer?.stopMeetMedia();
        this.chatPeer = null;
        this.registry.releaseMeet(this.opts.remoteAccount);
    }

    resendOffer(): void {
        this.chatPeer?.resendOffer();
    }

    getLocalStream(): MediaStream | null {
        return this.chatPeer?.getMeetLocalStream() ?? null;
    }

    getRemoteStream(): MediaStream | null {
        return this.chatPeer?.getMeetRemoteStream() ?? null;
    }

    getVideoActuallyDisabled(): boolean {
        return this.chatPeer?.getMeetVideoActuallyDisabled() ?? false;
    }

    setAudioEnabled(on: boolean): void {
        this.chatPeer?.setMeetAudioEnabled(on);
    }

    setVideoEnabled(on: boolean): void {
        this.chatPeer?.setMeetVideoEnabled(on);
    }
}

export function createSharedMeetPeer(
    registry: PeerTransportRegistry,
    opts: SharedMeetPeerOptions,
): SharedMeetPeer {
    return new SharedMeetPeer(registry, opts);
}
