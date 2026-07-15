import type { RealtimeClient } from "./realtime-client";
import type { ClientRealtimeFrame } from "./realtime-protocol";

export type SignalKind =
    | "offer"
    | "answer"
    | "candidate"
    | "end-of-candidates";

export type OutboundSignal = {
    sessionId: string;
    to: string;
    kind: SignalKind;
    sdp?: string;
    candidate?: string;
    sdpMid?: string;
    sdpMLineIndex?: number;
};

export type WebRtcSignalingClientOptions = {
    debugLog?: (event: string, detail?: Record<string, unknown>) => void;
    shortSessionId?: (sessionId: string) => string;
};

/**
 * Narrow client for x-webrtc-sig session join and SDP/ICE relay.
 * Uses the same websocket as {@link RealtimeClient}.
 */
export class WebRtcSignalingClient {
    private readonly debugLog?: (
        event: string,
        detail?: Record<string, unknown>,
    ) => void;

    private readonly shortSessionId: (sessionId: string) => string;

    constructor(
        private readonly realtime: RealtimeClient,
        opts: WebRtcSignalingClientOptions = {},
    ) {
        this.debugLog = opts.debugLog;
        this.shortSessionId =
            opts.shortSessionId ??
            ((sessionId) =>
                sessionId.length <= 16
                    ? sessionId
                    : `${sessionId.slice(0, 14)}…`);
    }

    joinSession(sessionId: string): void {
        this.debugLog?.("joinSession → server", {
            sessionId: this.shortSessionId(sessionId),
            clientInstanceId: this.realtime.instanceId,
        });
        this.send({
            t: "joinSession",
            sessionId,
            clientInstanceId: this.realtime.instanceId,
        });
    }

    leaveSession(sessionId: string, reason?: string): void {
        this.send({
            t: "leaveSession",
            sessionId,
            ...(reason ? { reason } : {}),
        });
    }

    participantState(
        sessionId: string,
        state: {
            audioMuted?: boolean;
            videoMuted?: boolean;
        },
    ): void {
        this.debugLog?.("participantState → server", {
            sessionId: this.shortSessionId(sessionId),
            audioMuted: state.audioMuted,
            videoMuted: state.videoMuted,
        });
        this.send({
            t: "participantState",
            sessionId,
            state: {
                ...(state.audioMuted != null
                    ? { audioMuted: state.audioMuted }
                    : {}),
                ...(state.videoMuted != null
                    ? { videoMuted: state.videoMuted }
                    : {}),
            },
        });
    }

    signal(payload: OutboundSignal): void {
        this.debugLog?.("signal → server", {
            sessionId: this.shortSessionId(payload.sessionId),
            to: payload.to,
            kind: payload.kind,
            hasSdp: payload.sdp != null,
            hasCandidate: payload.candidate != null,
        });
        this.send({
            t: "signal",
            sessionId: payload.sessionId,
            to: payload.to,
            kind: payload.kind,
            ...(payload.sdp != null ? { sdp: payload.sdp } : {}),
            ...(payload.candidate != null ? { candidate: payload.candidate } : {}),
            ...(payload.sdpMid != null ? { sdpMid: payload.sdpMid } : {}),
            ...(payload.sdpMLineIndex != null
                ? { sdpMLineIndex: payload.sdpMLineIndex }
                : {}),
        });
    }

    private send(frame: ClientRealtimeFrame): void {
        if (!this.realtime.isSessionReady) {
            this.debugLog?.("signal send skipped: ws not session-ready", {
                frame: frame.t,
            });
            return;
        }
        this.realtime.sendClientFrame(frame);
    }
}
