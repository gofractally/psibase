/** Optional websocket transport tracing (`localStorage.setItem('webrtc-realtime-trace','1')`). */
export function realtimeTraceLog(
    event: string,
    detail?: Record<string, unknown>,
): void {
    if (typeof localStorage === "undefined") return;
    if (localStorage.getItem("webrtc-realtime-trace") !== "1") return;
    if (typeof console === "undefined" || typeof console.info !== "function") {
        return;
    }
    console.info("[webrtc-realtime]", event, detail ?? {});
}
