import type { RealtimeClientOptions } from "./realtime-client-types";
import type { RealtimeConnectionState } from "./realtime-client-types";
import {
    formatParseFailure,
    newClientInstanceId,
    nextReconnectDelayMs,
    RAPID_CLOSE_AFTER_WELCOME_MS,
    rapidFailureReconnectDelayMs,
} from "./realtime-client-utils";
import { runRealtimeConnect } from "./realtime-connect";
import { dispatchServerFrame } from "./realtime-frame-dispatch";
import {
    chainHandlers,
    type RealtimeHandlers,
} from "./realtime-handlers";
import { HealthWatchdog } from "./realtime-health-watchdog";
import {
    type ClientRealtimeFrame,
    parseServerRealtimeFrameText,
} from "./realtime-protocol";
import { realtimeTraceLog } from "./realtime-trace";

export type {
    RealtimeClientOptions,
    RealtimeConnectionState,
} from "./realtime-client-types";
export type { RealtimeHandlers } from "./realtime-handlers";
export { mergeRealtimeHandlers } from "./realtime-handlers";

/**
 * Websocket client for `x-wrtcsig` `/ws` with subprotocol `psibase.realtime.v1`.
 * (Architecture docs say `x-webrtc-sig`; that is not a valid psibase account name.)
 */
export class RealtimeClient {
    private readonly baseUrl?: string | null;

    private readonly onFrameCb?: RealtimeClientOptions["onFrame"];

    private readonly onStateCb?: RealtimeClientOptions["onState"];

    private handlers: RealtimeHandlers = {};

    /** Incremental handler layers; {@link registerHandlers} adds, unsubscribe removes. */
    private readonly handlerLayers = new Map<number, RealtimeHandlers>();

    private nextHandlerLayerId = 1;

    private readonly authTokenProvider?: () => Promise<
        string | null | undefined
    >;

    private readonly authRequiredMessage: string;

    private readonly debugLog?: (
        event: string,
        detail?: Record<string, unknown>,
    ) => void;

    private readonly initialDelayMs: number;

    private readonly maxDelayMs: number;

    private readonly connectTimeoutMs: number;

    private readonly health: HealthWatchdog;

    private readonly clientInstanceId = newClientInstanceId();

    private _state: RealtimeConnectionState = "offline";

    private _lastError: string | null = null;

    private sessionReady = false;

    private userClosed = true;

    private ws: WebSocket | null = null;

    private reconnectTimer: ReturnType<typeof globalThis.setTimeout> | null =
        null;

    private reconnectAttempt = 0;

    /** Increments on each server `welcome`; used to distinguish first connect vs reconnect. */
    private welcomeCount = 0;

    /** Bumped to supersede in-flight connect attempts. */
    private connectGeneration = 0;

    private readonly connectInFlight = { value: false };

    /** Timestamp of the latest welcome on the active socket. */
    private welcomeAt = 0;

    /** Consecutive closes shortly after welcome — drives circuit-breaker backoff. */
    private rapidCloseStreak = 0;

    constructor(opts: RealtimeClientOptions = {}) {
        this.baseUrl = opts.baseUrl;
        this.onFrameCb = opts.onFrame;
        this.onStateCb = opts.onState;
        if (opts.handlers && Object.keys(opts.handlers).length > 0) {
            this.handlerLayers.set(0, opts.handlers);
        }
        this.rebuildHandlersFromLayers();
        this.authTokenProvider = opts.authTokenProvider;
        this.authRequiredMessage =
            opts.authRequiredMessage ??
            "Sign in to connect to realtime (provide an auth token).";
        this.debugLog = opts.debugLog;
        this.initialDelayMs = opts.reconnect?.initialDelayMs ?? 500;
        this.maxDelayMs = opts.reconnect?.maxDelayMs ?? 30_000;
        this.connectTimeoutMs = opts.reconnect?.connectTimeoutMs ?? 8_000;
        this.health = new HealthWatchdog({
            clientInstanceId: this.clientInstanceId,
            pingIntervalMs: opts.health?.pingIntervalMs ?? 10_000,
            pongTimeoutMs: opts.health?.pongTimeoutMs ?? 20_000,
            isActive: () => !this.userClosed && this.sessionReady,
            sendPing: () => this.sendJson({ t: "ping" }),
            setLastError: (message) => this.setLastError(message),
            debugLog: this.debugLog,
            onForceReconnect: () => this.reconnectNow(),
        });
    }

    get state(): RealtimeConnectionState {
        return this._state;
    }

    get lastError(): string | null {
        return this._lastError;
    }

    get instanceId(): string {
        return this.clientInstanceId;
    }

    get isSessionReady(): boolean {
        return this.sessionReady;
    }

    /** True when the latest welcome follows an earlier one on this client instance. */
    isReconnectWelcome(): boolean {
        return this.welcomeCount > 1;
    }

    /** Increments on each server `welcome`; used to detect stale joinSession. */
    get welcomeGeneration(): number {
        return this.welcomeCount;
    }

    /** Send a client frame once the websocket session is ready (post-welcome). */
    sendClientFrame(frame: ClientRealtimeFrame): void {
        this.sendJson(frame as unknown as Record<string, unknown>);
    }

    /** Merge additional server-frame handlers; returns unsubscribe. */
    registerHandlers(extra: RealtimeHandlers): () => void {
        const id = this.nextHandlerLayerId;
        this.nextHandlerLayerId += 1;
        this.handlerLayers.set(id, extra);
        this.rebuildHandlersFromLayers();
        return () => {
            if (!this.handlerLayers.delete(id)) return;
            this.rebuildHandlersFromLayers();
        };
    }

    /** Replace all server-frame handlers (used by WebRtcSessionProvider). */
    setHandlers(next: RealtimeHandlers): void {
        this.handlerLayers.clear();
        if (Object.keys(next).length > 0) {
            this.handlerLayers.set(0, next);
        }
        this.rebuildHandlersFromLayers();
    }

    private rebuildHandlersFromLayers(): void {
        let merged: RealtimeHandlers = {};
        for (const layer of this.handlerLayers.values()) {
            merged = chainHandlers(merged, layer);
        }
        this.handlers = merged;
    }

    private setState(next: RealtimeConnectionState) {
        if (this._state === next) return;
        this._state = next;
        this.onStateCb?.(next);
    }

    connect(): void {
        this.userClosed = false;
        this.cancelReconnectTimer();
        void this.runConnect(false);
    }

    close(): void {
        realtimeTraceLog("close", {
            instanceId: this.clientInstanceId,
        });
        this.userClosed = true;
        this.connectGeneration += 1;
        this.connectInFlight.value = false;
        this.cancelReconnectTimer();
        this.health.stop();

        const w = this.ws;
        this.ws = null;
        this.sessionReady = false;
        this.reconnectAttempt = 0;
        this.welcomeCount = 0;
        this.welcomeAt = 0;
        this.rapidCloseStreak = 0;
        this.setLastError(null);
        try {
            w?.close();
        } catch {
            /* ignore */
        }
        this.setState("offline");
    }

    ping(): void {
        this.sendJson({ t: "ping" });
    }

    reconnectNow(): void {
        if (this.userClosed) return;
        this.cancelReconnectTimer();
        this.reconnectAttempt = 0;
        void this.runConnect(true);
    }

    receive(rawText: string): void {
        const parsed = parseServerRealtimeFrameText(rawText);
        if (!parsed.ok) {
            this._lastError = formatParseFailure(parsed);
            if (
                typeof rawText === "string" &&
                rawText.includes('"t":"signal"') &&
                typeof console !== "undefined" &&
                typeof console.warn === "function"
            ) {
                console.warn(
                    "[webrtc-realtime] ws frame parse failed (signal?)",
                    formatParseFailure(parsed),
                    rawText.slice(0, 200),
                );
            }
            return;
        }

        this.health.noteInboundLiveness();
        dispatchServerFrame(parsed.value, {
            handlers: this.handlers,
            debugLog: this.debugLog,
            onWelcome: (frame) => {
                this.reconnectAttempt = 0;
                this.rapidCloseStreak = 0;
                this.welcomeAt = Date.now();
                this.welcomeCount += 1;
                this.sessionReady = true;
                this.setState("connected");
                this.debugLog?.("ws ← welcome", {
                    user: frame.user,
                    welcomeGeneration: this.welcomeCount,
                    instanceId: this.clientInstanceId,
                });
                this.sendClientReady();
                this.health.start();
            },
            onFrame: this.onFrameCb,
        });
    }

    private sendClientReady(): void {
        this.sendJson({
            t: "clientReady",
            clientInstanceId: this.clientInstanceId,
            active: true,
            visible: typeof document === "undefined" ? true : !document.hidden,
            supports: { audio: true, video: true, data: true },
        });
    }

    private setLastError(message: string | null) {
        this._lastError = message;
    }

    private cancelReconnectTimer() {
        if (this.reconnectTimer != null) {
            globalThis.clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }

    private scheduleReconnect() {
        if (this.userClosed) return;

        const delay =
            this.rapidCloseStreak > 0
                ? rapidFailureReconnectDelayMs(
                      this.rapidCloseStreak,
                      this.initialDelayMs,
                      this.maxDelayMs,
                  )
                : nextReconnectDelayMs(
                      this.reconnectAttempt,
                      this.initialDelayMs,
                      this.maxDelayMs,
                  );
        this.reconnectAttempt += 1;

        this.setState("reconnecting");
        this.cancelReconnectTimer();
        this.reconnectTimer = globalThis.setTimeout(() => {
            this.reconnectTimer = null;
            if (this.userClosed) return;
            void this.runConnect(false);
        }, delay);
    }

    private noteSessionClosed(
        sessionWasReady: boolean,
        connectStartedAt: number,
    ) {
        if (!sessionWasReady) return;
        const ageMs =
            this.welcomeAt > 0
                ? Date.now() - this.welcomeAt
                : Date.now() - connectStartedAt;
        if (ageMs < RAPID_CLOSE_AFTER_WELCOME_MS) {
            this.rapidCloseStreak += 1;
            this.debugLog?.("ws rapid close streak", {
                instanceId: this.clientInstanceId,
                streak: this.rapidCloseStreak,
                sessionAgeMs: ageMs,
            });
        } else {
            this.rapidCloseStreak = 0;
        }
        this.welcomeAt = 0;
    }

    private isStableReady(): boolean {
        return (
            this.sessionReady &&
            this.ws != null &&
            this.ws.readyState === WebSocket.OPEN
        );
    }

    private sendJson(payload: Record<string, unknown>): void {
        if (!this.sessionReady || this.ws?.readyState !== WebSocket.OPEN) {
            this._lastError = "realtime websocket is not ready (await welcome)";
            return;
        }
        try {
            this.ws.send(JSON.stringify(payload));
        } catch (e) {
            this._lastError = e instanceof Error ? e.message : String(e);
        }
    }

    private async runConnect(force: boolean): Promise<void> {
        const self = this;
        await runRealtimeConnect(
            {
                get userClosed() {
                    return self.userClosed;
                },
                set userClosed(v: boolean) {
                    self.userClosed = v;
                },
                get connectGeneration() {
                    return self.connectGeneration;
                },
                set connectGeneration(v: number) {
                    self.connectGeneration = v;
                },
                get sessionReady() {
                    return self.sessionReady;
                },
                set sessionReady(v: boolean) {
                    self.sessionReady = v;
                },
                get ws() {
                    return self.ws;
                },
                set ws(v: WebSocket | null) {
                    self.ws = v;
                },
                get lastError() {
                    return self._lastError;
                },
                clientInstanceId: self.clientInstanceId,
                authTokenProvider: self.authTokenProvider,
                authRequiredMessage: self.authRequiredMessage,
                connectTimeoutMs: self.connectTimeoutMs,
                baseUrl: self.baseUrl,
                debugLog: self.debugLog,
                setState: (s) => self.setState(s),
                setLastError: (m) => self.setLastError(m),
                scheduleReconnect: () => self.scheduleReconnect(),
                receive: (t) => self.receive(t),
                stopHealthWatchdog: () => self.health.stop(),
                noteSessionClosed: (ready, at) =>
                    self.noteSessionClosed(ready, at),
            },
            force,
            () => self.isStableReady(),
            self.connectInFlight,
        );
    }
}
