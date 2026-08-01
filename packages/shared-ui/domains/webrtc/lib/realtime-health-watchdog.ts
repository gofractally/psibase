import { churnDisablesHealthReconnect } from "./realtime-client-utils";
import { realtimeTraceLog } from "./realtime-trace";

export type HealthWatchdogHooks = {
    clientInstanceId: string;
    pingIntervalMs: number;
    pongTimeoutMs: number;
    isActive: () => boolean;
    sendPing: () => void;
    setLastError: (message: string | null) => void;
    debugLog?: (event: string, detail?: Record<string, unknown>) => void;
    onForceReconnect: () => void;
};

/** Ping/pong liveness watchdog for an open realtime websocket. */
export class HealthWatchdog {
    private pingTimer: ReturnType<typeof globalThis.setInterval> | null = null;

    private pongDeadlineTimer: ReturnType<typeof globalThis.setTimeout> | null =
        null;

    private lastInboundFrameAt = 0;

    constructor(private readonly hooks: HealthWatchdogHooks) {}

    noteInboundLiveness(): void {
        this.lastInboundFrameAt = Date.now();
        if (this.pongDeadlineTimer != null) {
            globalThis.clearTimeout(this.pongDeadlineTimer);
            this.pongDeadlineTimer = null;
        }
    }

    start(): void {
        this.stop();
        const { pingIntervalMs, pongTimeoutMs } = this.hooks;
        if (pingIntervalMs <= 0 || pongTimeoutMs <= 0) return;
        this.lastInboundFrameAt = Date.now();
        this.pingTimer = globalThis.setInterval(() => {
            if (!this.hooks.isActive()) return;
            try {
                this.hooks.sendPing();
            } catch {
                /* ignore */
            }
            if (this.pongDeadlineTimer == null) {
                this.pongDeadlineTimer = globalThis.setTimeout(() => {
                    this.pongDeadlineTimer = null;
                    if (!this.hooks.isActive()) return;
                    const sinceLast = Date.now() - this.lastInboundFrameAt;
                    if (sinceLast < pongTimeoutMs) return;
                    realtimeTraceLog("ws health watchdog: forcing reconnect", {
                        instanceId: this.hooks.clientInstanceId,
                        sinceLastFrameMs: sinceLast,
                        pongTimeoutMs,
                    });
                    this.hooks.setLastError(
                        `ws health watchdog: ${sinceLast}ms since last frame`,
                    );
                    if (churnDisablesHealthReconnect()) {
                        this.hooks.debugLog?.(
                            "ws health watchdog: reconnect disabled",
                            {
                                instanceId: this.hooks.clientInstanceId,
                                sinceLastFrameMs: sinceLast,
                            },
                        );
                        return;
                    }
                    this.hooks.onForceReconnect();
                }, pongTimeoutMs);
            }
        }, pingIntervalMs);
    }

    stop(): void {
        if (this.pingTimer != null) {
            globalThis.clearInterval(this.pingTimer);
            this.pingTimer = null;
        }
        if (this.pongDeadlineTimer != null) {
            globalThis.clearTimeout(this.pongDeadlineTimer);
            this.pongDeadlineTimer = null;
        }
    }
}
