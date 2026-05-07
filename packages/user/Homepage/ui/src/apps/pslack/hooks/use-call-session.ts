import {
    useCallback,
    useEffect,
    useRef,
    useState,
    type MutableRefObject,
    type RefObject,
} from "react";

import type { IceServerConfig } from "../lib/protocol";
import {
    PslackCallWebRtcSession,
    type InboundCallAnswer,
    type InboundCallCandidate,
    type InboundCallMediaState,
    type InboundCallOffer,
} from "../lib/call-webrtc-session";
import type { PslackWsClient, PslackWsPublicState } from "../lib/ws-client";

export type ActiveCallRtcSnapshot = {
    callId: string;
    direction: "incoming" | "outgoing";
    wantVideo: boolean;
    wantAudio: boolean;
};

/** Wire RTCPeerConnection + streams for one active service-frame Meet call keyed by {@link mediaCallKey}. */
export function useCallSession(opts: {
    mediaCallKey: string | null;
    callSnapshot: ActiveCallRtcSnapshot | null;
    wsState: PslackWsPublicState;
    iceServersRef: RefObject<IceServerConfig[] | null>;
    clientRef: RefObject<PslackWsClient | null>;
    activeCallRef: RefObject<{
        callId: string;
        source: string;
        status: string;
    } | null>;
    webrtcBridgeRef: MutableRefObject<{
        onOffer?: (frame: InboundCallOffer) => void;
        onAnswer?: (frame: InboundCallAnswer) => void;
        onCandidate?: (frame: InboundCallCandidate) => void;
        onMediaState?: (frame: InboundCallMediaState) => void;
    }>;
    onMediaAcquisitionFailed: (callId: string) => void;
    onIceFailedHangup: (callId: string) => void;
}): {
    localStream: MediaStream | null;
    remoteStream: MediaStream | null;
    audioMuted: boolean;
    videoMuted: boolean;
    remoteAudioMuted: boolean;
    remoteVideoMuted: boolean;
    audioOnlyFallback: boolean;
    toggleAudio: () => void;
    toggleVideo: () => void;
} {
    const {
        mediaCallKey,
        callSnapshot,
        wsState,
        iceServersRef,
        clientRef,
        activeCallRef,
        webrtcBridgeRef,
        onMediaAcquisitionFailed,
        onIceFailedHangup,
    } = opts;

    const [localStream, setLocalStream] = useState<MediaStream | null>(null);
    const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
    const [audioMuted, setAudioMuted] = useState(false);
    const [videoMuted, setVideoMuted] = useState(false);
    const [remoteAudioMuted, setRemoteAudioMuted] = useState(false);
    const [remoteVideoMuted, setRemoteVideoMuted] = useState(false);
    const [audioOnlyFallback, setAudioOnlyFallback] = useState(false);

    const webrtcSessionRef = useRef<PslackCallWebRtcSession | null>(null);
    const audioMutedRef = useRef(false);
    const videoMutedRef = useRef(false);

    useEffect(() => {
        const teardownStreams = () => {
            setLocalStream(null);
            setRemoteStream(null);
            setAudioMuted(false);
            setVideoMuted(false);
            setRemoteAudioMuted(false);
            setRemoteVideoMuted(false);
            setAudioOnlyFallback(false);
            audioMutedRef.current = false;
            videoMutedRef.current = false;
        };

        if (!mediaCallKey || wsState !== "synced") {
            webrtcSessionRef.current?.close();
            webrtcSessionRef.current = null;
            webrtcBridgeRef.current = {};
            teardownStreams();
            return;
        }

        const snap = callSnapshot;
        const client = clientRef.current;
        if (
            !snap ||
            snap.callId !== mediaCallKey ||
            !client ||
            !activeCallRef.current ||
            activeCallRef.current.callId !== mediaCallKey ||
            activeCallRef.current.source !== "service-frame" ||
            activeCallRef.current.status !== "connected"
        ) {
            return;
        }

        const session = new PslackCallWebRtcSession({
            callId: snap.callId,
            direction: snap.direction,
            wantVideo: snap.wantVideo,
            wantAudio: snap.wantAudio,
            iceServersConfig: iceServersRef.current,
            client,
            onLocalStream: (stream) => {
                setLocalStream(stream);
                if (stream) {
                    setAudioOnlyFallback(session.getVideoActuallyDisabled());
                }
            },
            onRemoteStream: setRemoteStream,
            onIceFailed: () => {
                onIceFailedHangup(snap.callId);
            },
        });
        webrtcSessionRef.current = session;
        webrtcBridgeRef.current = {
            onOffer: (f) => session.handleRemoteOffer(f),
            onAnswer: (f) => session.handleRemoteAnswer(f),
            onCandidate: (f) => session.handleRemoteCandidate(f),
            onMediaState: (f) => {
                if (f.callId !== snap.callId) return;
                setRemoteAudioMuted(f.audioMuted);
                setRemoteVideoMuted(f.videoMuted);
            },
        };

        void session.start().catch(() => {
            if (
                !webrtcSessionRef.current ||
                webrtcSessionRef.current !== session ||
                activeCallRef.current?.callId !== snap.callId
            ) {
                return;
            }
            onMediaAcquisitionFailed(snap.callId);
        });

        return () => {
            session.close();
            webrtcSessionRef.current = null;
            webrtcBridgeRef.current = {};
            teardownStreams();
        };
    }, [
        mediaCallKey,
        wsState,
        callSnapshot,
        iceServersRef,
        clientRef,
        activeCallRef,
        webrtcBridgeRef,
        onMediaAcquisitionFailed,
        onIceFailedHangup,
    ]);

    const toggleAudio = useCallback(() => {
        if (!mediaCallKey) return;
        const ac = activeCallRef.current;
        if (
            !ac ||
            ac.callId !== mediaCallKey ||
            ac.source !== "service-frame" ||
            ac.status !== "connected"
        ) {
            return;
        }
        const next = !audioMutedRef.current;
        audioMutedRef.current = next;
        setAudioMuted(next);
        webrtcSessionRef.current?.setAudioEnabled(!next);
        clientRef.current?.callMediaState(
            mediaCallKey,
            next,
            videoMutedRef.current,
        );
    }, [mediaCallKey, activeCallRef, clientRef]);

    const toggleVideo = useCallback(() => {
        if (!mediaCallKey) return;
        const ac = activeCallRef.current;
        if (
            !ac ||
            ac.callId !== mediaCallKey ||
            ac.source !== "service-frame" ||
            ac.status !== "connected"
        ) {
            return;
        }
        const next = !videoMutedRef.current;
        videoMutedRef.current = next;
        setVideoMuted(next);
        webrtcSessionRef.current?.setVideoEnabled(!next);
        clientRef.current?.callMediaState(
            mediaCallKey,
            audioMutedRef.current,
            next,
        );
    }, [mediaCallKey, activeCallRef, clientRef]);

    return {
        localStream,
        remoteStream,
        audioMuted,
        videoMuted,
        remoteAudioMuted,
        remoteVideoMuted,
        audioOnlyFallback,
        toggleAudio,
        toggleVideo,
    };
}
