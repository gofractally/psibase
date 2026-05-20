import type { IceServerConfig } from "./protocol";
import type { PslackWsClient } from "./ws-client";
import { acquirePslackMeetLocalMedia } from "./local-media";

export type InboundCallOffer = {
    t: "callOffer";
    callId: string;
    from: string;
    sdp: string;
};

export type InboundCallAnswer = {
    t: "callAnswer";
    callId: string;
    from: string;
    sdp: string;
};

export type InboundCallCandidate = {
    t: "callCandidate";
    callId: string;
    from: string;
    candidate: string | null;
    sdpMid?: string;
    sdpMLineIndex?: number;
};

export type InboundCallMediaState = {
    t: "callMediaState";
    callId: string;
    from: string;
    audioMuted: boolean;
    videoMuted: boolean;
};

const FALLBACK_STUN: RTCIceServer[] = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun.cloudflare.com:3478" },
];

function urlScheme(u: string): string {
    const t = u.trim();
    const i = t.indexOf(":");
    if (i <= 0) return "";
    return t.slice(0, i).toLowerCase();
}

function listUrls(s: IceServerConfig): string[] {
    return typeof s.urls === "string" ? [s.urls] : s.urls;
}

/** Match x-pslack service validation: STUN without secrets; TURN requires username + credential. */
export function iceServerConfigIsValidForClients(s: IceServerConfig): boolean {
    const urls = listUrls(s).map((u) => u.trim()).filter(Boolean);
    if (!urls.length) return false;
    const schemes = urls.map(urlScheme);
    const hasTurn = schemes.some((x) => x === "turn" || x === "turns");
    const hasStun = schemes.some((x) => x === "stun" || x === "stuns");
    if (hasTurn) {
        const u = s.username?.trim() ?? "";
        const c = s.credential?.trim() ?? "";
        return u.length > 0 && c.length > 0;
    }
    return hasStun && !s.username && !s.credential;
}

function sanitizeIceConfig(servers: IceServerConfig[]): IceServerConfig[] {
    return servers.filter((s) => iceServerConfigIsValidForClients(s));
}

function toRtcIceServers(servers: IceServerConfig[] | null): RTCIceServer[] {
    if (!servers?.length) return FALLBACK_STUN;
    const cleaned = sanitizeIceConfig(servers);
    if (!cleaned.length) return FALLBACK_STUN;
    return cleaned.map((s) => {
        const base: RTCIceServer = {
            urls: s.urls as string | string[],
        };
        if (s.username != null && s.username !== "") {
            base.username = s.username;
        }
        if (s.credential != null && s.credential !== "") {
            base.credential = s.credential;
        }
        return base;
    });
}
export type StartPslackCallWebRtcParams = {
    callId: string;
    direction: "incoming" | "outgoing";
    wantVideo: boolean;
    wantAudio: boolean;
    iceServersConfig: IceServerConfig[] | null;
    client: PslackWsClient;
    onLocalStream: (s: MediaStream | null) => void;
    onRemoteStream: (s: MediaStream | null) => void;
    onIceFailed: () => void;
};

/**
 * Manages RTCPeerConnection + getUserMedia for a single connected psibase DM call.
 * Signaling is delivered via {@link PslackCallWebRtcSession.handleRemoteOffer} etc. from websocket handlers.
 */
export class PslackCallWebRtcSession {
    readonly callId: string;

    private readonly init: StartPslackCallWebRtcParams;

    private readonly client: PslackWsClient;

    private readonly onLocalStream: (s: MediaStream | null) => void;

    private readonly onRemoteStream: (s: MediaStream | null) => void;

    private readonly onIceFailed: () => void;

    private pc: RTCPeerConnection | null = null;

    private localStream: MediaStream | null = null;

    private videoActuallyDisabled = false;

    private makingOffer = false;

    private ignoreOffer = false;

    private readonly polite: boolean;

    private runningChain: Promise<void> = Promise.resolve();

    private pendingRemoteIce: RTCIceCandidateInit[] = [];

    private iceFailedSent = false;

    private closed = false;

    private startPromise: Promise<void> | null = null;

    constructor(params: StartPslackCallWebRtcParams) {
        this.callId = params.callId;
        this.init = params;
        this.client = params.client;
        this.onLocalStream = params.onLocalStream;
        this.onRemoteStream = params.onRemoteStream;
        this.onIceFailed = params.onIceFailed;
        this.polite = params.direction === "incoming";
    }

    start(): Promise<void> {
        if (this.startPromise) return this.startPromise;
        this.startPromise = this.doStart();
        return this.startPromise;
    }

    private async doStart(): Promise<void> {
        const params = this.init;
        const { stream, videoDisabled } = await acquirePslackMeetLocalMedia(
            params.wantVideo,
            params.wantAudio,
        );
        if (this.closed) {
            for (const t of stream.getTracks()) {
                t.stop();
            }
            return;
        }
        this.videoActuallyDisabled = videoDisabled;
        this.localStream = stream;
        this.onLocalStream(stream);

        const iceServers = toRtcIceServers(params.iceServersConfig);
        const pc = new RTCPeerConnection({ iceServers });
        if (this.closed) {
            pc.close();
            for (const t of stream.getTracks()) {
                t.stop();
            }
            this.localStream = null;
            return;
        }
        this.pc = pc;

        for (const t of stream.getTracks()) {
            pc.addTrack(t, stream);
        }

        pc.ontrack = (ev) => {
            if (ev.streams[0]) {
                this.onRemoteStream(ev.streams[0]);
            }
        };

        pc.onicecandidate = (ev) => {
            if (this.closed) return;
            this.client.callCandidate(this.callId, ev.candidate);
        };

        pc.oniceconnectionstatechange = () => {
            const st = pc.iceConnectionState;
            if (st === "failed") {
                this.tryIceFailed();
            }
        };

        if (params.direction === "outgoing") {
            await this.createAndSendOffer();
        }
    }

    private tryIceFailed() {
        if (this.iceFailedSent || this.closed) return;
        this.iceFailedSent = true;
        this.onIceFailed();
    }

    private enqueueSignaling(fn: () => Promise<void>) {
        this.runningChain = this.runningChain
            .then(fn)
            .catch(() => undefined);
    }

    /** Apply trickle ICE that arrived before {@link RTCPeerConnection.remoteDescription}. */
    private async flushBufferedRemoteCandidates(
        pc: RTCPeerConnection,
    ): Promise<void> {
        const buf = this.pendingRemoteIce.splice(0, this.pendingRemoteIce.length);
        for (const init of buf) {
            if (this.closed) return;
            try {
                await pc.addIceCandidate(new RTCIceCandidate(init));
            } catch {
                /* ignore reorder / glare */
            }
        }
    }

    handleRemoteOffer(frame: InboundCallOffer): void {
        if (frame.callId !== this.callId) return;
        this.enqueueSignaling(async () => {
            if (this.startPromise) await this.startPromise;
            const pc = this.pc;
            if (!pc) return;

            const offerCollision =
                this.makingOffer || pc.signalingState !== "stable";
            this.ignoreOffer = !this.polite && offerCollision;
            if (this.ignoreOffer) {
                return;
            }

            await pc.setRemoteDescription(
                new RTCSessionDescription({
                    type: "offer",
                    sdp: frame.sdp,
                }),
            );
            await this.flushBufferedRemoteCandidates(pc);
            await pc.setLocalDescription(await pc.createAnswer());
            await this.flushBufferedRemoteCandidates(pc);
            const loc = pc.localDescription;
            if (loc) {
                this.client.callAnswer(this.callId, loc.sdp);
            }
        });
    }

    handleRemoteAnswer(frame: InboundCallAnswer): void {
        if (frame.callId !== this.callId) return;
        this.enqueueSignaling(async () => {
            if (this.startPromise) await this.startPromise;
            const pc = this.pc;
            if (!pc) return;
            await pc.setRemoteDescription(
                new RTCSessionDescription({
                    type: "answer",
                    sdp: frame.sdp,
                }),
            );
            await this.flushBufferedRemoteCandidates(pc);
        });
    }

    handleRemoteCandidate(frame: InboundCallCandidate): void {
        if (frame.callId !== this.callId) return;
        this.enqueueSignaling(async () => {
            if (this.startPromise) await this.startPromise;
            const pc = this.pc;
            if (!pc || this.closed) return;
            if (frame.candidate === null) {
                return;
            }
            const init: RTCIceCandidateInit = {
                candidate: frame.candidate,
                sdpMid: frame.sdpMid,
                sdpMLineIndex: frame.sdpMLineIndex,
            };
            try {
                if (!pc.remoteDescription) {
                    this.pendingRemoteIce.push(init);
                    return;
                }
                await pc.addIceCandidate(new RTCIceCandidate(init));
            } catch {
                /* ignore parse / add races */
            }
        });
    }

    private async createAndSendOffer(): Promise<void> {
        const pc = this.pc;
        if (!pc || this.closed) return;
        this.makingOffer = true;
        try {
            await pc.setLocalDescription(await pc.createOffer());
            const loc = pc.localDescription;
            if (loc && !this.closed && this.pc === pc) {
                this.client.callOffer(this.callId, loc.sdp);
            }
        } finally {
            this.makingOffer = false;
        }
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

    getVideoActuallyDisabled(): boolean {
        return this.videoActuallyDisabled;
    }

    close(): void {
        if (this.closed) return;
        this.closed = true;
        this.pendingRemoteIce.length = 0;
        const pc = this.pc;
        this.pc = null;
        try {
            pc?.close();
        } catch {
            /* ignore */
        }
        if (this.localStream) {
            for (const t of this.localStream.getTracks()) {
                t.stop();
            }
            this.localStream = null;
        }
        this.onLocalStream(null);
        this.onRemoteStream(null);
    }
}
