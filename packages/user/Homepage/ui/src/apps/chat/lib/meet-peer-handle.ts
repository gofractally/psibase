import type { SignalKind } from "./webrtc-signaling-client";

/** Minimal Meet peer surface used by av-call orchestrators. */
export interface MeetPeerHandle {
    readonly sessionId: string;
    readonly isMediaConnected: boolean;
    readonly isDisposed: boolean;
    start(): Promise<void>;
    dispose(): void;
    resendOffer(): void;
    getLocalStream(): MediaStream | null;
    getRemoteStream(): MediaStream | null;
    getVideoActuallyDisabled(): boolean;
    setAudioEnabled(on: boolean): void;
    setVideoEnabled(on: boolean): void;
    handleRemoteSignal?(frame: {
        from?: string;
        kind: SignalKind;
        sdp?: string;
        candidate?: string;
        sdpMid?: string;
        sdpMLineIndex?: number;
    }): Promise<void>;
}
