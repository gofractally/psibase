import { siblingUrl } from "@psibase/common-lib";

import {
    type ClientRealtimeFrame,
    type ParseResult,
    REALTIME_AUTH_SUBPROTOCOL_PREFIX,
    REALTIME_SERVICE,
    REALTIME_SUBPROTOCOL_V1,
    type ServerRealtimeFrame,
    parseServerRealtimeFrameText,
} from "./realtime-protocol";
import { realtimeTraceLog } from "./realtime-trace";

/** User-facing realtime transport state (architecture §5.1 / M1 gate). */
export type RealtimeConnectionState = "offline" | "reconnecting" | "connected";

export type RealtimeHandlers = {
    [K in ServerRealtimeFrame["t"]]?: (
        frame: Extract<ServerRealtimeFrame, { t: K }>,
    ) => void;
};

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
     * F3: WS health watchdog. The client sends a `ping` every
     * `pingIntervalMs` (default 10 s). If no `pong` (or any inbound frame,
     * which we treat as liveness) arrives within `pongTimeoutMs`
     * (default 20 s), the socket is force-closed and reconnection kicks
     * in. Set either to `0` to disable.
     */
    health?: {
        pingIntervalMs?: number;
        pongTimeoutMs?: number;
    };
}

function siblingHttpToWsUrl(httpUrlString: string): string {
    const u = new URL(httpUrlString);
    u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
    return u.href;
}

function formatParseFailure(
    r: Exclude<ParseResult<ServerRealtimeFrame>, { ok: true }>,
): string {
    const errObj = r.error;
    if (errObj && typeof errObj === "object" && "flatten" in errObj) {
        const f = (errObj as { flatten: () => Record<string, unknown> })
            .flatten;
        if (typeof f === "function") {
            try {
                return JSON.stringify(f());
            } catch {
                /* fall through */
            }
        }
    }
    if (errObj instanceof Error) return errObj.message;
    return String(errObj);
}

function nextReconnectDelayMs(
    attempt: number,
    initialMs: number,
    maxMs: number,
): number {
    const cap = Math.min(maxMs, initialMs * 2 ** attempt);
    return Math.floor(Math.random() * (cap + 1));
}

/** Closes sooner than this after welcome count as rapid failure (storm guard). */
const RAPID_CLOSE_AFTER_WELCOME_MS = 500;

function churnDisablesHealthReconnect(): boolean {
    try {
        return (
            typeof localStorage !== "undefined" &&
            localStorage.getItem("chat-churn-disable-health-reconnect") === "1"
        );
    } catch {
        return false;
    }
}

function chainHandlers(
    prev: RealtimeHandlers,
    extra: RealtimeHandlers,
): RealtimeHandlers {
    type HandlerFn = (frame: ServerRealtimeFrame) => void;
    const merged: Record<string, HandlerFn | undefined> = {
        ...(prev as Record<string, HandlerFn | undefined>),
    };
    for (const key of Object.keys(extra) as (keyof RealtimeHandlers)[]) {
        const next = extra[key] as HandlerFn | undefined;
        if (!next) continue;
        const existing = merged[key as string];
        if (existing) {
            merged[key as string] = (frame) => {
                existing(frame);
                next(frame);
            };
        } else {
            merged[key as string] = next;
        }
    }
    return merged as RealtimeHandlers;
}

let clientInstanceCounter = 0;

function newClientInstanceId(): string {
    clientInstanceCounter += 1;
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
        return crypto.randomUUID();
    }
    return `rt-${Date.now()}-${clientInstanceCounter}`;
}

/**
 * Websocket client for {@link REALTIME_SERVICE} `/ws` with
 * subprotocol {@link REALTIME_SUBPROTOCOL_V1}.
 * (Architecture docs say `x-webrtc-sig`; that is not a valid psibase account name.)
 */
export class RealtimeClient {
    private readonly baseUrl?: string | null;

    private readonly onFrameCb?: (frame: ServerRealtimeFrame) => void;

    private readonly onStateCb?: (state: RealtimeConnectionState) => void;

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

    private readonly pingIntervalMs: number;

    private readonly pongTimeoutMs: number;

    private pingTimer: ReturnType<typeof globalThis.setInterval> | null = null;

    private pongDeadlineTimer: ReturnType<typeof globalThis.setTimeout> | null =
        null;

    /** Monotonic timestamp of the last inbound frame (any frame, not just pong). */
    private lastInboundFrameAt = 0;

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

    /** Bumped to supersede in-flight {@link runConnect} attempts. */
    private connectGeneration = 0;

    private connectInFlight = false;

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
        this.pingIntervalMs = opts.health?.pingIntervalMs ?? 10_000;
        this.pongTimeoutMs = opts.health?.pongTimeoutMs ?? 20_000;
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

    /** Replace all server-frame handlers (used by {@link WebRtcSessionProvider}). */
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

    private wsUrl(): string {
        const http = siblingUrl(this.baseUrl, REALTIME_SERVICE, "/ws");
        return siblingHttpToWsUrl(http);
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
        this.connectInFlight = false;
        this.cancelReconnectTimer();
        this.stopHealthWatchdog();

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
        const frame = parsed.value;

        this.noteInboundLiveness();

        switch (frame.t) {
            case "welcome":
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
                this.startHealthWatchdog();
                this.handlers.welcome?.(frame);
                break;
            case "presenceSnapshot":
                this.handlers.presenceSnapshot?.(frame);
                break;
            case "presence":
                this.handlers.presence?.(frame);
                break;
            case "error":
                if (frame.code === "signal-trace") {
                    realtimeTraceLog("ws ← signal-trace (ignored)", {
                        reason: frame.reason,
                        sessionId: frame.sessionId,
                    });
                    break;
                }
                this.debugLog?.("ws ← error", {
                    code: frame.code,
                    reason: frame.reason,
                    sessionId: frame.sessionId,
                });
                this.handlers.error?.(frame);
                break;
            case "pong":
                this.handlers.pong?.(frame);
                break;
            case "sessionInvite":
                this.debugLog?.("ws ← sessionInvite", {
                    sessionId: frame.sessionId,
                    from: frame.from,
                    purpose: frame.purpose,
                });
                this.handlers.sessionInvite?.(frame);
                break;
            case "participantJoined":
                this.debugLog?.("ws ← participantJoined", {
                    sessionId: frame.sessionId,
                    participant: frame.participant,
                });
                this.handlers.participantJoined?.(frame);
                break;
            case "participantState":
                this.handlers.participantState?.(frame);
                break;
            case "signal":
                this.debugLog?.("ws ← signal", {
                    kind: frame.kind,
                    from: frame.from,
                    to: frame.to,
                    sessionId: frame.sessionId,
                });
                this.handlers.signal?.(frame);
                break;
            case "sessionEnded":
                this.handlers.sessionEnded?.(frame);
                break;
            case "sessionSnapshot":
                this.debugLog?.("ws ← sessionSnapshot", {
                    sessionId: frame.sessionId,
                    epoch: frame.epoch,
                    joined: frame.joinedParticipants,
                    pending: frame.pendingParticipants,
                });
                this.handlers.sessionSnapshot?.(frame);
                break;
            case "transportLost":
                this.debugLog?.("ws ← transportLost", {
                    sessionId: frame.sessionId,
                    participant: frame.participant,
                });
                this.handlers.transportLost?.(frame);
                break;
            default:
                break;
        }

        this.onFrameCb?.(frame);
    }

    private noteInboundLiveness(): void {
        this.lastInboundFrameAt = Date.now();
        if (this.pongDeadlineTimer != null) {
            globalThis.clearTimeout(this.pongDeadlineTimer);
            this.pongDeadlineTimer = null;
        }
    }

    private startHealthWatchdog(): void {
        this.stopHealthWatchdog();
        if (this.pingIntervalMs <= 0 || this.pongTimeoutMs <= 0) return;
        this.lastInboundFrameAt = Date.now();
        this.pingTimer = globalThis.setInterval(() => {
            if (this.userClosed || !this.sessionReady) return;
            try {
                this.sendJson({ t: "ping" });
            } catch {
                /* ignore */
            }
            if (this.pongDeadlineTimer == null) {
                this.pongDeadlineTimer = globalThis.setTimeout(() => {
                    this.pongDeadlineTimer = null;
                    if (this.userClosed || !this.sessionReady) return;
                    const sinceLast = Date.now() - this.lastInboundFrameAt;
                    if (sinceLast < this.pongTimeoutMs) return;
                    realtimeTraceLog("ws health watchdog: forcing reconnect", {
                        instanceId: this.clientInstanceId,
                        sinceLastFrameMs: sinceLast,
                        pongTimeoutMs: this.pongTimeoutMs,
                    });
                    this.setLastError(
                        `ws health watchdog: ${sinceLast}ms since last frame`,
                    );
                    if (churnDisablesHealthReconnect()) {
                        this.debugLog?.(
                            "ws health watchdog: reconnect disabled",
                            {
                                instanceId: this.clientInstanceId,
                                sinceLastFrameMs: sinceLast,
                            },
                        );
                        return;
                    }
                    this.reconnectNow();
                }, this.pongTimeoutMs);
            }
        }, this.pingIntervalMs);
    }

    private stopHealthWatchdog(): void {
        if (this.pingTimer != null) {
            globalThis.clearInterval(this.pingTimer);
            this.pingTimer = null;
        }
        if (this.pongDeadlineTimer != null) {
            globalThis.clearTimeout(this.pongDeadlineTimer);
            this.pongDeadlineTimer = null;
        }
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
                ? this.rapidFailureReconnectDelayMs()
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

    private rapidFailureReconnectDelayMs(): number {
        const exponent = Math.min(this.rapidCloseStreak - 1, 8);
        return Math.min(
            this.maxDelayMs,
            Math.max(this.initialDelayMs, this.initialDelayMs * 2 ** exponent),
        );
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
        if (this.userClosed) return;

        if (!force && this.isStableReady()) {
            return;
        }

        if (!force && this.connectInFlight) {
            return;
        }

        const generation = ++this.connectGeneration;
        this.connectInFlight = true;

        try {
            this.setState("reconnecting");
            this.sessionReady = false;

            const previous = this.ws;
            if (previous) {
                this.ws = null;
                try {
                    realtimeTraceLog("runConnect closing previous ws", {
                        instanceId: this.clientInstanceId,
                    });
                    previous.close();
                } catch {
                    /* ignore */
                }
            }

            const token = await this.authTokenProvider?.();
            if (this.userClosed || generation !== this.connectGeneration) {
                return;
            }
            if (!token) {
                this._lastError = this.authRequiredMessage;
                this.scheduleReconnect();
                return;
            }
            const url = this.wsUrl();
            const protocols = token
                ? [
                      REALTIME_SUBPROTOCOL_V1,
                      `${REALTIME_AUTH_SUBPROTOCOL_PREFIX}${token}`,
                  ]
                : [REALTIME_SUBPROTOCOL_V1];
            const connectStartedAt = Date.now();
            this.debugLog?.("ws connect start", {
                url,
                instanceId: this.clientInstanceId,
            });
            const ws = new WebSocket(url, protocols);
            const connectReadyTimer =
                this.connectTimeoutMs > 0
                    ? globalThis.setTimeout(() => {
                          if (
                              this.userClosed ||
                              this.ws !== ws ||
                              this.sessionReady
                          ) {
                              return;
                          }
                          this.debugLog?.("ws connect timeout", {
                              instanceId: this.clientInstanceId,
                              elapsedMs: Date.now() - connectStartedAt,
                              connectTimeoutMs: this.connectTimeoutMs,
                          });
                          this.setLastError(
                              `realtime websocket welcome timeout after ${this.connectTimeoutMs}ms`,
                          );
                          try {
                              ws.close();
                          } catch {
                              /* ignore */
                          }
                      }, this.connectTimeoutMs)
                    : null;
            const clearConnectReadyTimer = () => {
                if (connectReadyTimer != null) {
                    globalThis.clearTimeout(connectReadyTimer);
                }
            };

            ws.onopen = () => {
                if (
                    this.userClosed ||
                    this.ws !== ws ||
                    generation !== this.connectGeneration
                ) {
                    return;
                }
                this.setLastError(null);
                this.debugLog?.("ws open", {
                    instanceId: this.clientInstanceId,
                    elapsedMs: Date.now() - connectStartedAt,
                });
            };

            ws.onmessage = (ev: MessageEvent<string | ArrayBuffer>): void => {
                if (
                    this.userClosed ||
                    this.ws !== ws ||
                    generation !== this.connectGeneration
                ) {
                    return;
                }
                if (typeof ev.data !== "string") {
                    this._lastError =
                        `${REALTIME_SERVICE} websocket message was not UTF-16 text`;
                    return;
                }
                this.receive(ev.data);
                if (this.sessionReady) {
                    clearConnectReadyTimer();
                }
            };

            ws.onerror = () => {
                if (
                    this.userClosed ||
                    this.ws !== ws ||
                    generation !== this.connectGeneration
                ) {
                    return;
                }
                clearConnectReadyTimer();
                this.debugLog?.("ws error", {
                    instanceId: this.clientInstanceId,
                    elapsedMs: Date.now() - connectStartedAt,
                });
                this.setLastError("realtime websocket error");
            };

            ws.onclose = (ev) => {
                clearConnectReadyTimer();
                realtimeTraceLog("ws.onclose", {
                    instanceId: this.clientInstanceId,
                    isCurrent: this.ws === ws,
                    userClosed: this.userClosed,
                    sessionReady: this.sessionReady,
                    code: ev?.code,
                    reason: ev?.reason,
                    wasClean: ev?.wasClean,
                });
                if (this.ws !== ws) {
                    return;
                }
                const sessionWasReady = this.sessionReady;
                this.debugLog?.("ws close", {
                    instanceId: this.clientInstanceId,
                    sessionReady: sessionWasReady,
                    elapsedMs: Date.now() - connectStartedAt,
                    code: ev?.code,
                    reason: ev?.reason,
                    wasClean: ev?.wasClean,
                    userClosed: this.userClosed,
                });
                this.ws = null;
                this.sessionReady = false;
                this.stopHealthWatchdog();

                if (this.userClosed) return;

                this.noteSessionClosed(sessionWasReady, connectStartedAt);
                this.setLastError(
                    this._lastError ?? "realtime websocket closed unexpectedly",
                );
                this.scheduleReconnect();
            };

            if (this.userClosed || generation !== this.connectGeneration) {
                try {
                    ws.close();
                } catch {
                    /* ignore */
                }
                return;
            }

            this.ws = ws;
            realtimeTraceLog("ws assigned", {
                instanceId: this.clientInstanceId,
            });
        } catch (e) {
            if (this.userClosed || generation !== this.connectGeneration) {
                return;
            }

            const msg =
                e instanceof Error
                    ? e.message
                    : typeof e === "string"
                      ? e
                      : "realtime connect failed";

            this.setLastError(msg);
            this.scheduleReconnect();
        } finally {
            if (generation === this.connectGeneration) {
                this.connectInFlight = false;
            }
        }
    }
}

export function mergeRealtimeHandlers(
    ...groups: readonly RealtimeHandlers[]
): RealtimeHandlers {
    let merged: RealtimeHandlers = {};
    for (const group of groups) {
        merged = chainHandlers(merged, group);
    }
    return merged;
}
