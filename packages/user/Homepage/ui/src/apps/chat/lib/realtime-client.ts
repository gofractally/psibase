import { siblingUrl } from "@psibase/common-lib";

import {
    parseServerRealtimeFrameText,
    REALTIME_AUTH_SUBPROTOCOL_PREFIX,
    REALTIME_SUBPROTOCOL_V1,
    type ParseResult,
    type ServerRealtimeFrame,
} from "./realtime-protocol";

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
    reconnect?: {
        initialDelayMs?: number;
        maxDelayMs?: number;
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
        const f = (
            errObj as { flatten: () => Record<string, unknown> }
        ).flatten;
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

let clientInstanceCounter = 0;

function newClientInstanceId(): string {
    clientInstanceCounter += 1;
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
        return crypto.randomUUID();
    }
    return `rt-${Date.now()}-${clientInstanceCounter}`;
}

/**
 * Websocket client for `x-webrtcsig` `/ws` with subprotocol `psibase.realtime.v1`.
 * M1: presence snapshot/delta and welcome ICE config; chat remains on x-pslack.
 */
export class RealtimeClient {
    private readonly baseUrl?: string | null;

    private readonly onFrameCb?: (frame: ServerRealtimeFrame) => void;

    private readonly onStateCb?: (state: RealtimeConnectionState) => void;

    private readonly handlers: RealtimeHandlers;

    private readonly authTokenProvider?: () => Promise<string | null | undefined>;

    private readonly initialDelayMs: number;

    private readonly maxDelayMs: number;

    private readonly clientInstanceId = newClientInstanceId();

    private _state: RealtimeConnectionState = "offline";

    private _lastError: string | null = null;

    private sessionReady = false;

    private userClosed = true;

    private ws: WebSocket | null = null;

    private reconnectTimer: ReturnType<typeof globalThis.setTimeout> | null =
        null;

    private reconnectAttempt = 0;

    constructor(opts: RealtimeClientOptions = {}) {
        this.baseUrl = opts.baseUrl;
        this.onFrameCb = opts.onFrame;
        this.onStateCb = opts.onState;
        this.handlers = opts.handlers ?? {};
        this.authTokenProvider = opts.authTokenProvider;
        this.initialDelayMs = opts.reconnect?.initialDelayMs ?? 500;
        this.maxDelayMs = opts.reconnect?.maxDelayMs ?? 30_000;
    }

    get state(): RealtimeConnectionState {
        return this._state;
    }

    get lastError(): string | null {
        return this._lastError;
    }

    private setState(next: RealtimeConnectionState) {
        if (this._state === next) return;
        this._state = next;
        this.onStateCb?.(next);
    }

    private wsUrl(): string {
        const http = siblingUrl(this.baseUrl, "x-webrtcsig", "/ws");
        return siblingHttpToWsUrl(http);
    }

    connect(): void {
        this.userClosed = false;
        this.cancelReconnectTimer();
        void this.runConnect();
    }

    close(): void {
        this.userClosed = true;
        this.cancelReconnectTimer();

        const w = this.ws;
        this.ws = null;
        this.sessionReady = false;
        this.reconnectAttempt = 0;
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
        void this.runConnect();
    }

    receive(rawText: string): void {
        const parsed = parseServerRealtimeFrameText(rawText);
        if (!parsed.ok) {
            this._lastError = formatParseFailure(parsed);
            return;
        }
        const frame = parsed.value;

        switch (frame.t) {
            case "welcome":
                this.reconnectAttempt = 0;
                this.sessionReady = true;
                this.setState("connected");
                this.sendClientReady();
                this.handlers.welcome?.(frame);
                break;
            case "presenceSnapshot":
                this.handlers.presenceSnapshot?.(frame);
                break;
            case "presence":
                this.handlers.presence?.(frame);
                break;
            case "error":
                this.handlers.error?.(frame);
                break;
            case "pong":
                this.handlers.pong?.(frame);
                break;
            default:
                break;
        }

        this.onFrameCb?.(frame);
    }

    private sendClientReady(): void {
        this.sendJson({
            t: "clientReady",
            clientInstanceId: this.clientInstanceId,
            active: true,
            visible:
                typeof document === "undefined" ? true : !document.hidden,
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

        const delay = nextReconnectDelayMs(
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
            void this.runConnect();
        }, delay);
    }

    private sendJson(payload: Record<string, unknown>): void {
        if (!this.sessionReady || this.ws?.readyState !== WebSocket.OPEN) {
            this._lastError =
                "realtime websocket is not ready (await welcome)";
            return;
        }
        try {
            this.ws.send(JSON.stringify(payload));
        } catch (e) {
            this._lastError = e instanceof Error ? e.message : String(e);
        }
    }

    private async runConnect(): Promise<void> {
        if (this.userClosed) return;

        try {
            this.setState("reconnecting");
            this.sessionReady = false;

            const token = await this.authTokenProvider?.();
            if (this.userClosed) return;
            if (!token) {
                this._lastError =
                    "Sign in to Chat to connect (choose an account when prompted).";
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
            const ws = new WebSocket(url, protocols);

            ws.onopen = () => {
                if (this.userClosed || this.ws !== ws) return;
                this.setLastError(null);
            };

            ws.onmessage = (ev: MessageEvent<string | ArrayBuffer>): void => {
                if (this.userClosed || this.ws !== ws) return;
                if (typeof ev.data !== "string") {
                    this._lastError =
                        "x-webrtcsig websocket message was not UTF-16 text";
                    return;
                }
                this.receive(ev.data);
            };

            ws.onerror = () => {
                if (this.userClosed || this.ws !== ws) return;
                this.setLastError("realtime websocket error");
            };

            ws.onclose = () => {
                if (this.ws === ws) {
                    this.ws = null;
                    this.sessionReady = false;
                }

                if (this.userClosed) return;

                this.setLastError(
                    this._lastError ?? "realtime websocket closed unexpectedly",
                );
                this.scheduleReconnect();
            };

            this.ws = ws;
        } catch (e) {
            if (this.userClosed) return;

            const msg =
                e instanceof Error
                    ? e.message
                    : typeof e === "string"
                      ? e
                      : "realtime connect failed";

            this.setLastError(msg);
            this.scheduleReconnect();
        }
    }
}
