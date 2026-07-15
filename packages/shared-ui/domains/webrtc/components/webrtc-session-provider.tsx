import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
} from "react";

import {
    mergeRealtimeHandlers,
    RealtimeClient,
    type RealtimeClientOptions,
    type RealtimeConnectionState,
    type RealtimeHandlers,
} from "../lib/realtime-client";
import type { IceServerConfig } from "../lib/realtime-schemas";
import { WebRtcSignalingClient } from "../lib/webrtc-signaling-client";

export type WebRtcSessionProviderProps = {
    children: ReactNode;
    /** Returns bearer token for x-webrtc-sig websocket subprotocol auth. */
    authTokenProvider: () => Promise<string | null | undefined>;
    baseUrl?: RealtimeClientOptions["baseUrl"];
    reconnect?: RealtimeClientOptions["reconnect"];
    health?: RealtimeClientOptions["health"];
    authRequiredMessage?: string;
    debugLog?: RealtimeClientOptions["debugLog"];
    /** Connect on mount (default true). */
    autoConnect?: boolean;
};

export type WebRtcSessionContextValue = {
    /** Live websocket client for this page load; null before mount completes. */
    client: RealtimeClient | null;
    signaling: WebRtcSignalingClient | null;
    connectionState: RealtimeConnectionState;
    lastError: string | null;
    /** Account from the latest server `welcome` frame. */
    connectedAccount: string | null;
    iceServers: readonly IceServerConfig[];
    /** True after the first `welcome` on this client instance. */
    sessionReady: boolean;
    /** True when the latest welcome follows an earlier one (websocket reconnect). */
    isReconnectWelcome: boolean;
    /** Subscribe to server frames; returns an unsubscribe function. */
    registerHandlers: (handlers: RealtimeHandlers) => () => void;
    reconnectNow: () => void;
};

const WebRtcSessionContext = createContext<WebRtcSessionContextValue | null>(
    null,
);

export function WebRtcSessionProvider({
    children,
    authTokenProvider,
    baseUrl,
    reconnect,
    health,
    authRequiredMessage,
    debugLog,
    autoConnect = true,
}: WebRtcSessionProviderProps) {
    const clientRef = useRef<RealtimeClient | null>(null);
    const handlerSubsRef = useRef(new Map<number, RealtimeHandlers>());
    const nextSubIdRef = useRef(0);
    const providerHandlersRef = useRef<RealtimeHandlers>({});
    const authTokenProviderRef = useRef(authTokenProvider);
    authTokenProviderRef.current = authTokenProvider;
    const debugLogRef = useRef(debugLog);
    debugLogRef.current = debugLog;
    const reconnectRef = useRef(reconnect);
    const healthRef = useRef(health);

    const [client, setClient] = useState<RealtimeClient | null>(null);
    const [connectionState, setConnectionState] =
        useState<RealtimeConnectionState>("offline");
    const [lastError, setLastError] = useState<string | null>(null);
    const [connectedAccount, setConnectedAccount] = useState<string | null>(
        null,
    );
    const [iceServers, setIceServers] = useState<readonly IceServerConfig[]>(
        [],
    );
    const [sessionReady, setSessionReady] = useState(false);
    const [isReconnectWelcome, setIsReconnectWelcome] = useState(false);

    const rebuildClientHandlers = useCallback(() => {
        const rt = clientRef.current;
        if (!rt) return;
        const merged = mergeRealtimeHandlers(
            providerHandlersRef.current,
            ...handlerSubsRef.current.values(),
        );
        rt.setHandlers(merged);
    }, []);

    const registerHandlers = useCallback(
        (handlers: RealtimeHandlers): (() => void) => {
            const id = nextSubIdRef.current;
            nextSubIdRef.current += 1;
            handlerSubsRef.current.set(id, handlers);
            rebuildClientHandlers();
            return () => {
                handlerSubsRef.current.delete(id);
                rebuildClientHandlers();
            };
        },
        [rebuildClientHandlers],
    );

    useEffect(() => {
        providerHandlersRef.current = {
            welcome: (frame) => {
                setConnectedAccount(frame.user);
                setIceServers(frame.iceServers);
                setSessionReady(true);
                setIsReconnectWelcome(clientRef.current?.isReconnectWelcome() ?? false);
                setLastError(null);
            },
        };

        const realtime = new RealtimeClient({
            baseUrl,
            authTokenProvider: () => authTokenProviderRef.current(),
            reconnect: reconnectRef.current,
            health: healthRef.current,
            authRequiredMessage,
            debugLog: (event, detail) =>
                debugLogRef.current?.(event, detail),
            onState: (state) => {
                setConnectionState(state);
                if (state === "offline") {
                    setSessionReady(false);
                    setIsReconnectWelcome(false);
                    setConnectedAccount(null);
                    setIceServers([]);
                }
            },
            onFrame: () => {
                const c = clientRef.current;
                setLastError(c?.lastError ?? null);
            },
        });

        clientRef.current = realtime;
        setClient(realtime);
        rebuildClientHandlers();

        if (autoConnect) {
            realtime.connect();
        }

        return () => {
            handlerSubsRef.current.clear();
            realtime.close();
            clientRef.current = null;
            setClient(null);
            setConnectionState("offline");
            setSessionReady(false);
            setIsReconnectWelcome(false);
            setConnectedAccount(null);
            setIceServers([]);
        };
    }, [authRequiredMessage, autoConnect, baseUrl, rebuildClientHandlers]);

    const signaling = useMemo(
        () =>
            client
                ? new WebRtcSignalingClient(client, {
                      debugLog: (event, detail) =>
                          debugLogRef.current?.(event, detail),
                  })
                : null,
        [client],
    );

    const reconnectNow = useCallback(() => {
        clientRef.current?.reconnectNow();
    }, []);

    const value = useMemo<WebRtcSessionContextValue>(
        () => ({
            client,
            signaling,
            connectionState,
            lastError,
            connectedAccount,
            iceServers,
            sessionReady,
            isReconnectWelcome,
            registerHandlers,
            reconnectNow,
        }),
        [
            client,
            signaling,
            connectionState,
            lastError,
            connectedAccount,
            iceServers,
            sessionReady,
            isReconnectWelcome,
            registerHandlers,
            reconnectNow,
        ],
    );

    return (
        <WebRtcSessionContext.Provider value={value}>
            {children}
        </WebRtcSessionContext.Provider>
    );
}

export function useWebRtcSession(): WebRtcSessionContextValue {
    const ctx = useContext(WebRtcSessionContext);
    if (!ctx) {
        throw new Error(
            "useWebRtcSession must be used within WebRtcSessionProvider",
        );
    }
    return ctx;
}
