import type { ParseResult, ServerRealtimeFrame } from "./realtime-protocol";

export function siblingHttpToWsUrl(httpUrlString: string): string {
    const u = new URL(httpUrlString);
    u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
    return u.href;
}

export function formatParseFailure(
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

export function nextReconnectDelayMs(
    attempt: number,
    initialMs: number,
    maxMs: number,
): number {
    const cap = Math.min(maxMs, initialMs * 2 ** attempt);
    return Math.floor(Math.random() * (cap + 1));
}

/** Closes sooner than this after welcome count as rapid failure (storm guard). */
export const RAPID_CLOSE_AFTER_WELCOME_MS = 500;

export function churnDisablesHealthReconnect(): boolean {
    try {
        return (
            typeof localStorage !== "undefined" &&
            localStorage.getItem("chat-churn-disable-health-reconnect") === "1"
        );
    } catch {
        return false;
    }
}

let clientInstanceCounter = 0;

export function newClientInstanceId(): string {
    clientInstanceCounter += 1;
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
        return crypto.randomUUID();
    }
    return `rt-${Date.now()}-${clientInstanceCounter}`;
}

export function rapidFailureReconnectDelayMs(
    rapidCloseStreak: number,
    initialDelayMs: number,
    maxDelayMs: number,
): number {
    const exponent = Math.min(rapidCloseStreak - 1, 8);
    return Math.min(
        maxDelayMs,
        Math.max(initialDelayMs, initialDelayMs * 2 ** exponent),
    );
}
