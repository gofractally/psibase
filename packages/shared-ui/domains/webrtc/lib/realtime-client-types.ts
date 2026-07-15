import type { RealtimeHandlers } from "./realtime-handlers";
import type { ServerRealtimeFrame } from "./realtime-protocol";

/** User-facing realtime transport state. */
export type RealtimeConnectionState = "offline" | "reconnecting" | "connected";

export interface RealtimeClientOptions {
    baseUrl?: string | null;
    onFrame?: (frame: ServerRealtimeFrame) => void;
    onState?: (state: RealtimeConnectionState) => void;
    handlers?: RealtimeHandlers;
    authTokenProvider?: () => Promise<string | null | undefined>;
    /** Shown when authTokenProvider returns no token. */
    authRequiredMessage?: string;
    /** Optional verbose frame logging for app-specific diagnostics. */
    debugLog?: (event: string, detail?: Record<string, unknown>) => void;
    reconnect?: {
        initialDelayMs?: number;
        maxDelayMs?: number;
        /** Abort a websocket that does not reach welcome/session-ready quickly. */
        connectTimeoutMs?: number;
    };
    /**
     * WS health watchdog. The client sends a `ping` every `pingIntervalMs`
     * (default 10 s). If no inbound frame arrives within `pongTimeoutMs`
     * (default 20 s), the socket is force-closed and reconnection kicks in.
     * Set either to `0` to disable.
     */
    health?: {
        pingIntervalMs?: number;
        pongTimeoutMs?: number;
    };
}
