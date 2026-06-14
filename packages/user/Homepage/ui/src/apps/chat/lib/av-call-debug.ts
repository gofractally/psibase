const PREFIX = "[av-call]";

function tracingEnabled(): boolean {
    if (typeof localStorage === "undefined") return true;
    return localStorage.getItem("av-call-debug") !== "0";
}

export function shortSessionId(sessionId: string): string {
    if (sessionId.length <= 16) return sessionId;
    return `${sessionId.slice(0, 14)}…`;
}

export function shortSpaceId(spaceUuid: string): string {
    if (spaceUuid.length <= 20) return spaceUuid;
    return `${spaceUuid.slice(0, 18)}…`;
}

export function avCallLog(
    event: string,
    detail?: Record<string, unknown>,
): void {
    if (!tracingEnabled()) return;
    if (detail) {
        console.info(PREFIX, event, detail);
    } else {
        console.info(PREFIX, event);
    }
}

export function avCallRecord(
    event: string,
    detail?: Record<string, unknown>,
): void {
    avCallLog(event, detail);
}

/** Structured teardown-source marker for leave / hangup triage (e2e + manual). */
export function avCallTeardownLog(
    source: string,
    detail?: Record<string, unknown>,
): void {
    avCallLog(`teardown:${source}`, detail);
}
