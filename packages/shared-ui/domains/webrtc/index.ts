export {
    WebRtcSessionProvider,
    useWebRtcSession,
    type WebRtcSessionContextValue,
    type WebRtcSessionProviderProps,
} from "./components/webrtc-session-provider";

export {
    RealtimeClient,
    mergeRealtimeHandlers,
    type RealtimeClientOptions,
    type RealtimeConnectionState,
    type RealtimeHandlers,
} from "./lib/realtime-client";

export {
    WebRtcSignalingClient,
    type OutboundSignal,
    type SignalKind,
    type WebRtcSignalingClientOptions,
} from "./lib/webrtc-signaling-client";

export {
    REALTIME_AUTH_SUBPROTOCOL_PREFIX,
    REALTIME_SUBPROTOCOL_V1,
    parseServerRealtimeFrame,
    parseServerRealtimeFrameText,
    type ClientRealtimeFrame,
    type ParseFail,
    type ParseOk,
    type ParseResult,
    type ServerRealtimeFrame,
} from "./lib/realtime-protocol";

export {
    contactPresenceSchema,
    iceServerConfigSchema,
    presenceStatusSchema,
    type ContactPresence,
    type IceServerConfig,
} from "./lib/realtime-schemas";
