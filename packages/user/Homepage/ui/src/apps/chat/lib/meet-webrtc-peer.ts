import { avCallLog, avCallRecord, shortSessionId } from "./av-call-debug";
import { buildRtcPeerConnectionConfig } from "./ice-config";
import { acquireMeetLocalMedia } from "./local-media";
import type { IceServerConfig } from "./protocol";
import type { SignalKind, WebRtcSignalingClient } from "./webrtc-signaling-client";
import {
    isLocalDevWebRtcEnvironment,
    normalizeIceCandidateForEnvironment,
} from "./webrtc-local-dev-ice";

export type MeetWebRtcPeerHandlers = {
    onMediaConnected?: () => void;
    onLocalStream?: (stream: MediaStream | null) => void;
    onRemoteStream?: (stream: MediaStream | null) => void;
    onFailed?: (detail: string) => void;
    onTransportLost?: (detail: string) => void;
};

/**
 * Meet WebRTC peer helper: audio/video media tracks with SDP/ICE relay via
 * {@link WebRtcSignalingClient}. Shared by DM and group Meet flows; no data
 * channels.
 */
export class MeetWebRtcPeer {
    readonly sessionId: string;

    private readonly selfAccount: string;

    private readonly peerAccount: string;

    private readonly isInitiator: boolean;

    private readonly wantVideo: boolean;

    private readonly wantAudio: boolean;

    private readonly iceServers: IceServerConfig[] | null;

    private readonly signaling: WebRtcSignalingClient;

    private readonly handlers: MeetWebRtcPeerHandlers;

    /** When set, reuse this stream (group mesh) instead of acquiring again. */
    private readonly sharedLocalStream: MediaStream | null;

    private readonly ownsLocalStream: boolean;

    private pc: RTCPeerConnection | null = null;

    private localStream: MediaStream | null = null;

    private remoteStream: MediaStream | null = null;

    private videoActuallyDisabled = false;

    private disposed = false;

    private mediaConnected = false;

    private transportLostReported = false;

    private startPromise: Promise<void> | null = null;

    private signalingChain: Promise<void> = Promise.resolve();

    private pendingRemoteIce: RTCIceCandidateInit[] = [];

    /**
     * Guards `createAndSendOffer` against re-entry while
     * `createOffer`/`setLocalDescription` are still in flight. See the
     * matching field in {@link ChatDataWebRtcPeer.offerInFlight} for the full
     * race that motivates this flag.
     */
    private offerInFlight = false;

    constructor(params: {
        sessionId: string;
        selfAccount: string;
        peerAccount: string;
        iceServers: IceServerConfig[] | null;
        signaling: WebRtcSignalingClient;
        isInitiator: boolean;
        wantVideo: boolean;
        wantAudio: boolean;
        sharedLocalStream?: MediaStream | null;
        handlers?: MeetWebRtcPeerHandlers;
    }) {
        this.sessionId = params.sessionId;
        this.selfAccount = params.selfAccount;
        this.peerAccount = params.peerAccount;
        this.isInitiator = params.isInitiator;
        this.wantVideo = params.wantVideo;
        this.wantAudio = params.wantAudio;
        this.iceServers = params.iceServers;
        this.signaling = params.signaling;
        this.sharedLocalStream = params.sharedLocalStream ?? null;
        this.ownsLocalStream = !params.sharedLocalStream;
        this.handlers = params.handlers ?? {};
    }

    get isMediaConnected(): boolean {
        return this.mediaConnected;
    }

    get isDisposed(): boolean {
        return this.disposed;
    }

    getLocalStream(): MediaStream | null {
        return this.localStream;
    }

    getRemoteStream(): MediaStream | null {
        return this.remoteStream;
    }

    getVideoActuallyDisabled(): boolean {
        return this.videoActuallyDisabled;
    }

    start(): Promise<void> {
        if (this.startPromise) return this.startPromise;
        this.startPromise = this.doStart();
        return this.startPromise;
    }

    /** Re-send SDP offer after the peer joins (initiator only). */
    resendOffer(): void {
        if (this.disposed || !this.isInitiator || !this.pc) return;
        if (this.offerInFlight) {
            avCallRecord("resendOffer skipped (offer pending)", {
                sessionId: shortSessionId(this.sessionId),
                signalingState: this.pc.signalingState,
                offerInFlight: true,
            });
            return;
        }
        if (
            this.pc.signalingState === "have-local-offer" &&
            this.pc.localDescription?.sdp
        ) {
            avCallRecord("resendOffer retransmit", {
                sessionId: shortSessionId(this.sessionId),
                to: this.peerAccount,
                sdpBytes: this.pc.localDescription.sdp.length,
            });
            this.signaling.signal({
                sessionId: this.sessionId,
                to: this.peerAccount,
                kind: "offer",
                sdp: this.pc.localDescription.sdp,
            });
            return;
        }
        if (this.pc.signalingState === "have-local-offer") {
            avCallRecord("resendOffer skipped (offer pending)", {
                sessionId: shortSessionId(this.sessionId),
                signalingState: this.pc.signalingState,
                offerInFlight: false,
            });
            return;
        }
        avCallRecord("resendOffer", {
            sessionId: shortSessionId(this.sessionId),
        });
        void this.createAndSendOffer();
    }

    setAudioEnabled(on: boolean): void {
        this.localStream
            ?.getAudioTracks()
            .forEach((t) => {
                t.enabled = on;
            });
    }

    setVideoEnabled(on: boolean): void {
        this.localStream
            ?.getVideoTracks()
            .forEach((t) => {
                t.enabled = on;
            });
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.mediaConnected = false;
        try {
            this.pc?.close();
        } catch {
            /* ignore */
        }
        this.pc = null;
        if (this.localStream && this.ownsLocalStream) {
            for (const t of this.localStream.getTracks()) {
                t.stop();
            }
        }
        this.localStream = null;
        this.remoteStream = null;
        this.handlers.onLocalStream?.(null);
        this.handlers.onRemoteStream?.(null);
    }

    async handleRemoteSignal(frame: {
        from?: string;
        kind: SignalKind;
        sdp?: string;
        candidate?: string;
        sdpMid?: string;
        sdpMLineIndex?: number;
    }): Promise<void> {
        const from = frame.from ?? this.peerAccount;
        if (this.disposed || from !== this.peerAccount) return;

        await new Promise<void>((resolve, reject) => {
            this.signalingChain = this.signalingChain
                .then(async () => {
                    if (this.startPromise) await this.startPromise;
                    await this.applyRemoteSignal(frame);
                    resolve();
                })
                .catch((e) => {
                    reject(e);
                });
        }).catch((e) => {
            const detail =
                e instanceof Error ? e.message : "WebRTC signaling failed";
            avCallRecord("signaling error", { detail, kind: frame.kind });
            this.handlers.onFailed?.(detail);
        });
    }

    private async doStart(): Promise<void> {
        if (this.disposed) return;

        try {
            let stream: MediaStream;
            let videoDisabled: boolean;
            if (this.sharedLocalStream) {
                stream = this.sharedLocalStream;
                videoDisabled = !this.wantVideo;
            } else {
                const acquired = await acquireMeetLocalMedia(
                    this.wantVideo,
                    this.wantAudio,
                );
                stream = acquired.stream;
                videoDisabled = acquired.videoDisabled;
            }
            if (this.disposed) {
                if (this.ownsLocalStream) {
                    for (const t of stream.getTracks()) {
                        t.stop();
                    }
                }
                return;
            }

            this.videoActuallyDisabled = videoDisabled;
            this.localStream = stream;
            if (this.ownsLocalStream) {
                this.handlers.onLocalStream?.(stream);
            }

            const pc = new RTCPeerConnection(
                buildRtcPeerConnectionConfig(this.iceServers),
            );
            if (this.disposed) {
                pc.close();
                if (this.ownsLocalStream) {
                    for (const t of stream.getTracks()) {
                        t.stop();
                    }
                }
                this.localStream = null;
                return;
            }
            this.pc = pc;

            for (const t of stream.getTracks()) {
                pc.addTrack(t, stream);
            }

            pc.ontrack = (ev) => {
                if (this.disposed) return;
                const remote = ev.streams[0] ?? null;
                this.remoteStream = remote;
                this.handlers.onRemoteStream?.(remote);
            };

            pc.onicecandidate = (ev) => {
                if (this.disposed || !ev.candidate) return;
                const candidateLine = normalizeIceCandidateForEnvironment(
                    ev.candidate.candidate,
                );
                if (!candidateLine) return;
                this.signaling.signal({
                    sessionId: this.sessionId,
                    to: this.peerAccount,
                    kind: "candidate",
                    candidate: candidateLine,
                    sdpMid: ev.candidate.sdpMid ?? undefined,
                    sdpMLineIndex: ev.candidate.sdpMLineIndex ?? undefined,
                });
            };

            pc.oniceconnectionstatechange = () => {
                if (this.disposed || !this.pc) return;
                const iceState = this.pc.iceConnectionState;
                avCallRecord("pc iceConnectionState", {
                    sessionId: shortSessionId(this.sessionId),
                    state: iceState,
                });
                if (iceState === "failed") {
                    this.reportTransportLost(`ICE connection ${iceState}`);
                }
            };

            pc.onconnectionstatechange = () => {
                if (this.disposed || !this.pc) return;
                const state = this.pc.connectionState;
                avCallRecord("pc connectionState", {
                    sessionId: shortSessionId(this.sessionId),
                    state,
                });
                if (state === "connected") {
                    this.markMediaConnected();
                }
                if (state === "failed" || state === "closed") {
                    this.reportTransportLost(`WebRTC connection ${state}`);
                }
            };

            avCallLog("meet peer created", {
                sessionId: shortSessionId(this.sessionId),
                self: this.selfAccount,
                peer: this.peerAccount,
                isInitiator: this.isInitiator,
                wantVideo: this.wantVideo,
                wantAudio: this.wantAudio,
                localDevIceRewrite: isLocalDevWebRtcEnvironment(),
            });

            if (this.isInitiator) {
                await this.createAndSendOffer();
            }
        } catch (e) {
            const detail =
                e instanceof Error ? e.message : "Could not start av-call media";
            this.handlers.onFailed?.(detail);
        }
    }

    private markMediaConnected(): void {
        if (this.disposed || this.mediaConnected) return;
        this.mediaConnected = true;
        avCallLog("meet peer media connected", {
            sessionId: shortSessionId(this.sessionId),
        });
        this.handlers.onMediaConnected?.();
    }

    private reportTransportLost(detail: string): void {
        if (this.disposed || this.transportLostReported) return;
        this.transportLostReported = true;
        this.mediaConnected = false;
        this.handlers.onTransportLost?.(detail);
    }

    private async flushBufferedRemoteCandidates(): Promise<void> {
        const pc = this.pc;
        if (!pc) return;
        const buf = this.pendingRemoteIce.splice(
            0,
            this.pendingRemoteIce.length,
        );
        for (const init of buf) {
            if (this.disposed) return;
            try {
                await pc.addIceCandidate(new RTCIceCandidate(init));
            } catch {
                /* ignore reorder / glare */
            }
        }
    }

    private async applyRemoteSignal(frame: {
        kind: SignalKind;
        sdp?: string;
        candidate?: string;
        sdpMid?: string;
        sdpMLineIndex?: number;
    }): Promise<void> {
        const pc = this.pc;
        if (!pc || this.disposed) return;

        if (frame.kind === "offer" && frame.sdp) {
            await pc.setRemoteDescription({
                type: "offer",
                sdp: frame.sdp,
            });
            await this.flushBufferedRemoteCandidates();
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            await this.flushBufferedRemoteCandidates();
            if (answer.sdp) {
                this.signaling.signal({
                    sessionId: this.sessionId,
                    to: this.peerAccount,
                    kind: "answer",
                    sdp: answer.sdp,
                });
            }
            return;
        }

        if (frame.kind === "answer" && frame.sdp) {
            // Defense-in-depth (matches `ChatDataWebRtcPeer`): drop stale
            // answers when the PC is no longer expecting one. Calling
            // `setRemoteDescription` on a `stable` PC throws and surfaces as
            // a fatal failure.
            if (pc.signalingState !== "have-local-offer") {
                avCallRecord("applyRemote answer dropped (wrong state)", {
                    sessionId: shortSessionId(this.sessionId),
                    signalingState: pc.signalingState,
                    sdpBytes: frame.sdp.length,
                });
                return;
            }
            await pc.setRemoteDescription({
                type: "answer",
                sdp: frame.sdp,
            });
            await this.flushBufferedRemoteCandidates();
            return;
        }

        if (frame.kind === "candidate") {
            const candidateLine = normalizeIceCandidateForEnvironment(
                frame.candidate,
            );
            if (!candidateLine) return;
            const init: RTCIceCandidateInit = {
                candidate: candidateLine,
                sdpMid: frame.sdpMid ?? null,
                sdpMLineIndex: frame.sdpMLineIndex ?? null,
            };
            if (!pc.remoteDescription) {
                this.pendingRemoteIce.push(init);
                return;
            }
            try {
                await pc.addIceCandidate(new RTCIceCandidate(init));
            } catch {
                /* ignore parse / add races */
            }
            return;
        }

        if (frame.kind === "end-of-candidates") {
            if (pc.remoteDescription) {
                try {
                    await pc.addIceCandidate(null);
                } catch {
                    /* ignore end-of-candidates races */
                }
            }
        }
    }

    private async createAndSendOffer(): Promise<void> {
        const pc = this.pc;
        if (!pc || this.disposed) return;
        if (this.offerInFlight) {
            avCallRecord("createAndSendOffer skipped (already in flight)", {
                sessionId: shortSessionId(this.sessionId),
            });
            return;
        }
        this.offerInFlight = true;
        try {
            const offer = await pc.createOffer();
            if (this.disposed || !this.pc) return;
            await pc.setLocalDescription(offer);
            if (offer.sdp) {
                this.signaling.signal({
                    sessionId: this.sessionId,
                    to: this.peerAccount,
                    kind: "offer",
                    sdp: offer.sdp,
                });
            }
        } catch (e) {
            const detail =
                e instanceof Error ? e.message : "Could not create WebRTC offer";
            this.handlers.onFailed?.(detail);
        } finally {
            this.offerInFlight = false;
        }
    }
}
