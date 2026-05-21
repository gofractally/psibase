/** Timestamped DM compose/select tracing (disable: localStorage.setItem('dm-compose-timing','0')). */
const PREFIX = "[dm-compose]";

function enabled(): boolean {
    if (typeof localStorage === "undefined") return true;
    return localStorage.getItem("dm-compose-timing") !== "0";
}

export function composeTimingLog(
    event: string,
    detail?: Record<string, unknown>,
): void {
    if (!enabled()) return;
    if (typeof console === "undefined" || typeof console.info !== "function") {
        return;
    }
    const payload = {
        ts: performance.now(),
        wall: Date.now(),
        event,
        ...detail,
    };
    console.info(PREFIX, payload);
}
