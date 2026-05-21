/** Ring-buffer trace for homeNav wedge diagnosis (e2e + manual). */
const CHURN_RING_MAX = 500;

export type ChurnTraceEvent = {
    t: number;
    wall: number;
    event: string;
    route: string;
    search: string;
    detail?: Record<string, unknown>;
};

const churnRing: ChurnTraceEvent[] = [];

function churnTracingEnabled(): boolean {
    if (typeof localStorage === "undefined") return true;
    return localStorage.getItem("chat-churn-trace") !== "0";
}

export function recordChurnTrace(
    event: string,
    detail?: Record<string, unknown>,
): void {
    if (!churnTracingEnabled()) return;
    const entry: ChurnTraceEvent = {
        t: typeof performance !== "undefined" ? performance.now() : 0,
        wall: Date.now(),
        event,
        route:
            typeof location !== "undefined" ? location.pathname : "",
        search: typeof location !== "undefined" ? location.search : "",
        detail,
    };
    churnRing.push(entry);
    if (churnRing.length > CHURN_RING_MAX) {
        churnRing.splice(0, churnRing.length - CHURN_RING_MAX);
    }
    if (typeof console !== "undefined" && console.info) {
        console.info("[churn-trace]", event, detail ?? "");
    }
}

export function getChurnTraceEvents(): readonly ChurnTraceEvent[] {
    return churnRing;
}

export function clearChurnTraceEvents(): void {
    churnRing.length = 0;
}

declare global {
    interface Window {
        __chatChurnTrace?: {
            record: (
                event: string,
                detail?: Record<string, unknown>,
            ) => void;
            events: () => readonly ChurnTraceEvent[];
            clear: () => void;
            dump: () => string;
        };
        __chatChurnProbe?: () => Record<string, unknown>;
    }
}

let churnGlobalInstalled = false;

export function installChurnTraceGlobal(): void {
    if (churnGlobalInstalled || typeof window === "undefined") return;
    churnGlobalInstalled = true;
    window.__chatChurnTrace = {
        record: recordChurnTrace,
        events: getChurnTraceEvents,
        clear: clearChurnTraceEvents,
        dump: () => JSON.stringify(getChurnTraceEvents(), null, 2),
    };
}
