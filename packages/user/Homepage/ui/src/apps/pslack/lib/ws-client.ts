import { siblingUrl } from "@psibase/common-lib";

import {
    parseServerFrameText,
    type ParseResult,
    type ServerFrame,
} from "./protocol";

/** Negotiated websocket sub-protocols offered to `/ws`; v2 first (architecture §3.1). */
export const PSLACK_WS_SUBPROTOCOLS = [
    "psibase.pslack.v2",
    "psibase.pslack.v1",
] as const;
export const PSLACK_AUTH_SUBPROTOCOL_PREFIX = "psibase.bearer.";

export type PslackWsPublicState =
    | "idle"
    | "connecting"
    | "connected"
    | "synced"
    | "reconnecting"
    | "closed";

/** Handlers keyed by discriminant {@link ServerFrame}["t"]. */
export type PslackWsHandlers = {
    [K in ServerFrame["t"]]?: (
        frame: Extract<ServerFrame, { t: K }>,
    ) => void;
};

export interface PslackWsClientOptions {
    /**
     * Base URL for sibling resolution (`window.location` when omitted in {@link siblingUrl}).
     */
    baseUrl?: string | null;
    /** Called for every inbound frame after a successful parse (after typed handlers). */
    onFrame?: (frame: ServerFrame) => void;
    /** Lifecycle / connectivity callbacks. */
    onState?: (state: PslackWsPublicState) => void;
    handlers?: PslackWsHandlers;
    /** Optional bearer token provider for browser websocket auth. */
    authTokenProvider?: () => Promise<string | null | undefined>;
    /** Defaults used for exponential backoff + full jitter between reconnect attempts. */
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
    r: Exclude<ParseResult<ServerFrame>, { ok: true }>,
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
    /** Full jitter in [0, cap] */
    return Math.floor(Math.random() * (cap + 1));
}

/**
 * Stateful x-pslack websocket client for `wss://…/ws`; negotiates {@link PSLACK_WS_SUBPROTOCOLS}.
 */
export class PslackWsClient {
    private readonly baseUrl?: string | null;

    private readonly onFrameCb?: (frame: ServerFrame) => void;

    private readonly onStateCb?: (state: PslackWsPublicState) => void;

    private readonly handlers: PslackWsHandlers;

    private readonly authTokenProvider?: () => Promise<string | null | undefined>;

    private readonly initialDelayMs: number;

    private readonly maxDelayMs: number;

    private _state: PslackWsPublicState = "idle";

    private _lastError: string | null = null;

    /** After server {@link ServerFrame} `welcome`, client application frames may be sent. */
    private sessionReady = false;

    /** User called {@link close}; do not reconnect. */
    private userClosed = true;

    private ws: WebSocket | null = null;

    private reconnectTimer: ReturnType<typeof globalThis.setTimeout> | null =
        null;

    private reconnectAttempt = 0;

    constructor(opts: PslackWsClientOptions = {}) {
        this.baseUrl = opts.baseUrl;
        this.onFrameCb = opts.onFrame;
        this.onStateCb = opts.onState;
        this.handlers = opts.handlers ?? {};
        this.authTokenProvider = opts.authTokenProvider;
        this.initialDelayMs = opts.reconnect?.initialDelayMs ?? 500;
        this.maxDelayMs = opts.reconnect?.maxDelayMs ?? 30_000;
    }

    get state(): PslackWsPublicState {
        return this._state;
    }

    get lastError(): string | null {
        return this._lastError;
    }

    private setState(next: PslackWsPublicState) {
        if (this._state === next) return;
        this._state = next;
        this.onStateCb?.(next);
    }

    private wsUrl(): string {
        const http = siblingUrl(this.baseUrl, "x-pslack", "/ws");
        return siblingHttpToWsUrl(http);
    }

    /** Begins websocket auth + connect; repeats after failures unless {@link close} was called. */
    connect(): void {
        this.userClosed = false;
        this.cancelReconnectTimer();
        void this.runConnect();
    }

    /**
     * Stops reconnect timers, aborts auth bootstrap, and closes the socket. Further sends are ignored.
     * Call {@link connect} to attach again.
     */
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
        this.setState("closed");
    }

    sync(knownConversationIds: readonly string[] = []): void {
        const ids = [...knownConversationIds];
        const payload =
            ids.length === 0
                ? { t: "sync" as const }
                : { t: "sync" as const, knownConversationIds: ids };
        this.sendJson(payload);
    }

    openDm(member: string): void {
        this.sendJson({ t: "openDm", member });
    }

    openGroup(members: readonly string[]): void {
        this.sendJson({ t: "openGroup", members: [...members] });
    }

    /** Send a chat line (`say` frame). */
    send(
        conversationId: string,
        body: string,
        clientMsgId: string,
        clientTime?: number,
        to?: string,
    ): void {
        this.sendJson({
            t: "say",
            conversationId,
            body,
            clientMsgId,
            ...(clientTime === undefined ? {} : { clientTime }),
            ...(to === undefined ? {} : { to }),
        });
    }

    ping(): void {
        this.sendJson({ t: "ping" });
    }

    ack(conversationId: string, serverMsgId: number): void {
        this.sendJson({ t: "ack", conversationId, serverMsgId });
    }

    callInvite(
        conversationId: string,
        wantVideo: boolean,
        wantAudio: boolean,
        clientCallId: string,
    ): void {
        this.sendJson({
            t: "callInvite",
            conversationId,
            wantVideo,
            wantAudio,
            clientCallId,
        });
    }

    callAccept(callId: string): void {
        this.sendJson({ t: "callAccept", callId });
    }

    callDecline(callId: string, reason?: string): void {
        if (reason === undefined) {
            this.sendJson({ t: "callDecline", callId });
        } else {
            this.sendJson({ t: "callDecline", callId, reason });
        }
    }

    callHangup(callId: string, reason?: string): void {
        if (reason === undefined) {
            this.sendJson({ t: "callHangup", callId });
        } else {
            this.sendJson({ t: "callHangup", callId, reason });
        }
    }

    callOffer(callId: string, sdp: string): void {
        this.sendJson({ t: "callOffer", callId, sdp });
    }

    callAnswer(callId: string, sdp: string): void {
        this.sendJson({ t: "callAnswer", callId, sdp });
    }

    callCandidate(
        callId: string,
        candidate: RTCIceCandidate | null,
    ): void {
        if (!candidate) {
            this.sendJson({
                t: "callCandidate",
                callId,
                candidate: null,
            });
            return;
        }
        const init = candidate.toJSON();
        this.sendJson({
            t: "callCandidate",
            callId,
            candidate: init.candidate ?? null,
            sdpMid: init.sdpMid,
            sdpMLineIndex: init.sdpMLineIndex,
        });
    }

    callMediaState(
        callId: string,
        audioMuted: boolean,
        videoMuted: boolean,
    ): void {
        this.sendJson({
            t: "callMediaState",
            callId,
            audioMuted,
            videoMuted,
        });
    }

    signal(
        conversationId: string,
        toAccount: string,
        payload: unknown,
    ): void {
        this.sendJson({
            t: "signal",
            conversationId,
            to: toAccount,
            payload,
        });
    }

    /**
     * Parse a websocket text payload and dispatch typed handlers —
     * also used internally from the socket `message` event.
     */
    receive(rawText: string): void {
        const parsed = parseServerFrameText(rawText);
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
                this.handlers.welcome?.(frame);
                break;
            case "sync":
                this.handlers.sync?.(frame);
                this.setState("synced");
                break;
            case "conversation":
                this.handlers.conversation?.(frame);
                break;
            case "presence":
                this.handlers.presence?.(frame);
                break;
            case "message":
                this.handlers.message?.(frame);
                break;
            case "delivered":
                this.handlers.delivered?.(frame);
                break;
            case "error":
                this.handlers.error?.(frame);
                break;
            case "iceServers":
                this.handlers.iceServers?.(frame);
                break;
            case "callEvent":
                this.handlers.callEvent?.(frame);
                break;
            case "callError":
                this.handlers.callError?.(frame);
                break;
            case "callTimeout":
                this.handlers.callTimeout?.(frame);
                break;
            case "callInvite":
                this.handlers.callInvite?.(frame);
                break;
            case "callAccept":
                this.handlers.callAccept?.(frame);
                break;
            case "callDecline":
                this.handlers.callDecline?.(frame);
                break;
            case "callOffer":
                this.handlers.callOffer?.(frame);
                break;
            case "callAnswer":
                this.handlers.callAnswer?.(frame);
                break;
            case "callCandidate":
                this.handlers.callCandidate?.(frame);
                break;
            case "callMediaState":
                this.handlers.callMediaState?.(frame);
                break;
            case "callHangup":
                this.handlers.callHangup?.(frame);
                break;
            default:
                break;
        }

        this.onFrameCb?.(frame);
    }

    /** Clears backoff and starts a fresh login + websocket attempt (unless {@link close}d). */
    reconnectNow(): void {
        if (this.userClosed) return;
        this.cancelReconnectTimer();
        this.reconnectAttempt = 0;
        void this.runConnect();
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
                "websocket is not ready to send application frames (await welcome)";
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
            this.setState("connecting");
            this.sessionReady = false;

            const token = await this.authTokenProvider?.();
            if (this.userClosed) return;
            const url = this.wsUrl();
            const protocols = token
                ? [
                      ...PSLACK_WS_SUBPROTOCOLS,
                      `${PSLACK_AUTH_SUBPROTOCOL_PREFIX}${token}`,
                  ]
                : [...PSLACK_WS_SUBPROTOCOLS];
            const ws = new WebSocket(url, protocols);

            ws.onopen = () => {
                if (this.userClosed || this.ws !== ws) return;
                this.setLastError(null);
                /* Remain `connecting` until `welcome`; transport is open. */
            };

            ws.onmessage = (ev: MessageEvent<string | ArrayBuffer>): void => {
                if (this.userClosed || this.ws !== ws) return;
                if (typeof ev.data !== "string") {
                    this._lastError =
                        "x-pslack websocket message was not UTF-16 text";
                    return;
                }
                this.receive(ev.data);
            };

            ws.onerror = () => {
                if (this.userClosed || this.ws !== ws) return;
                this.setLastError("websocket error");
            };

            ws.onclose = () => {
                if (this.ws === ws) {
                    this.ws = null;
                    this.sessionReady = false;
                }

                if (this.userClosed) return;

                this.setLastError(
                    this._lastError ?? "websocket closed unexpectedly",
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
                      : "connect failed";

            this.setLastError(msg);
            this.scheduleReconnect();
        }
    }
}
