import { siblingUrl } from "@psibase/common-lib";

import type { RealtimeConnectionState } from "./realtime-client-types";
import { siblingHttpToWsUrl } from "./realtime-client-utils";
import {
    REALTIME_AUTH_SUBPROTOCOL_PREFIX,
    REALTIME_SERVICE,
    REALTIME_SUBPROTOCOL_V1,
} from "./realtime-protocol";
import { realtimeTraceLog } from "./realtime-trace";

export type RunConnectHost = {
    userClosed: boolean;
    connectGeneration: number;
    sessionReady: boolean;
    ws: WebSocket | null;
    clientInstanceId: string;
    lastError: string | null;
    authTokenProvider?: () => Promise<string | null | undefined>;
    authRequiredMessage: string;
    connectTimeoutMs: number;
    baseUrl?: string | null;
    debugLog?: (event: string, detail?: Record<string, unknown>) => void;
    setState: (state: RealtimeConnectionState) => void;
    setLastError: (message: string | null) => void;
    scheduleReconnect: () => void;
    receive: (rawText: string) => void;
    stopHealthWatchdog: () => void;
    noteSessionClosed: (
        sessionWasReady: boolean,
        connectStartedAt: number,
    ) => void;
};

/**
 * Open a websocket to `x-wrtcsig` `/ws` with bearer subprotocol auth.
 * Mutates `host` fields for the active socket / generation.
 */
export async function runRealtimeConnect(
    host: RunConnectHost,
    force: boolean,
    isStableReady: () => boolean,
    connectInFlight: { value: boolean },
): Promise<void> {
    if (host.userClosed) return;

    if (!force && isStableReady()) {
        return;
    }

    if (!force && connectInFlight.value) {
        return;
    }

    const generation = ++host.connectGeneration;
    connectInFlight.value = true;

    try {
        host.setState("reconnecting");
        host.sessionReady = false;

        const previous = host.ws;
        if (previous) {
            host.ws = null;
            try {
                realtimeTraceLog("runConnect closing previous ws", {
                    instanceId: host.clientInstanceId,
                });
                previous.close();
            } catch {
                /* ignore */
            }
        }

        const token = await host.authTokenProvider?.();
        if (host.userClosed || generation !== host.connectGeneration) {
            return;
        }
        if (!token) {
            host.setLastError(host.authRequiredMessage);
            host.scheduleReconnect();
            return;
        }
        const http = siblingUrl(host.baseUrl, REALTIME_SERVICE, "/ws");
        const url = siblingHttpToWsUrl(http);
        const protocols = [
            REALTIME_SUBPROTOCOL_V1,
            `${REALTIME_AUTH_SUBPROTOCOL_PREFIX}${token}`,
        ];
        const connectStartedAt = Date.now();
        host.debugLog?.("ws connect start", {
            url,
            instanceId: host.clientInstanceId,
        });
        const ws = new WebSocket(url, protocols);
        const connectReadyTimer =
            host.connectTimeoutMs > 0
                ? globalThis.setTimeout(() => {
                      if (
                          host.userClosed ||
                          host.ws !== ws ||
                          host.sessionReady
                      ) {
                          return;
                      }
                      host.debugLog?.("ws connect timeout", {
                          instanceId: host.clientInstanceId,
                          elapsedMs: Date.now() - connectStartedAt,
                          connectTimeoutMs: host.connectTimeoutMs,
                      });
                      host.setLastError(
                          `realtime websocket welcome timeout after ${host.connectTimeoutMs}ms`,
                      );
                      try {
                          ws.close();
                      } catch {
                          /* ignore */
                      }
                  }, host.connectTimeoutMs)
                : null;
        const clearConnectReadyTimer = () => {
            if (connectReadyTimer != null) {
                globalThis.clearTimeout(connectReadyTimer);
            }
        };

        ws.onopen = () => {
            if (
                host.userClosed ||
                host.ws !== ws ||
                generation !== host.connectGeneration
            ) {
                return;
            }
            host.setLastError(null);
            host.debugLog?.("ws open", {
                instanceId: host.clientInstanceId,
                elapsedMs: Date.now() - connectStartedAt,
            });
        };

        ws.onmessage = (ev: MessageEvent<string | ArrayBuffer>): void => {
            if (
                host.userClosed ||
                host.ws !== ws ||
                generation !== host.connectGeneration
            ) {
                return;
            }
            if (typeof ev.data !== "string") {
                host.setLastError(
                    `${REALTIME_SERVICE} websocket message was not UTF-16 text`,
                );
                return;
            }
            host.receive(ev.data);
            if (host.sessionReady) {
                clearConnectReadyTimer();
            }
        };

        ws.onerror = () => {
            if (
                host.userClosed ||
                host.ws !== ws ||
                generation !== host.connectGeneration
            ) {
                return;
            }
            clearConnectReadyTimer();
            host.debugLog?.("ws error", {
                instanceId: host.clientInstanceId,
                elapsedMs: Date.now() - connectStartedAt,
            });
            host.setLastError("realtime websocket error");
        };

        ws.onclose = (ev) => {
            clearConnectReadyTimer();
            realtimeTraceLog("ws.onclose", {
                instanceId: host.clientInstanceId,
                isCurrent: host.ws === ws,
                userClosed: host.userClosed,
                sessionReady: host.sessionReady,
                code: ev?.code,
                reason: ev?.reason,
                wasClean: ev?.wasClean,
            });
            if (host.ws !== ws) {
                return;
            }
            const sessionWasReady = host.sessionReady;
            host.debugLog?.("ws close", {
                instanceId: host.clientInstanceId,
                sessionReady: sessionWasReady,
                elapsedMs: Date.now() - connectStartedAt,
                code: ev?.code,
                reason: ev?.reason,
                wasClean: ev?.wasClean,
                userClosed: host.userClosed,
            });
            host.ws = null;
            host.sessionReady = false;
            host.stopHealthWatchdog();

            if (host.userClosed) return;

            host.noteSessionClosed(sessionWasReady, connectStartedAt);
            host.setLastError(
                host.lastError ?? "realtime websocket closed unexpectedly",
            );
            host.scheduleReconnect();
        };

        if (host.userClosed || generation !== host.connectGeneration) {
            try {
                ws.close();
            } catch {
                /* ignore */
            }
            return;
        }

        host.ws = ws;
        realtimeTraceLog("ws assigned", {
            instanceId: host.clientInstanceId,
        });
    } catch (e) {
        if (host.userClosed || generation !== host.connectGeneration) {
            return;
        }

        const msg =
            e instanceof Error
                ? e.message
                : typeof e === "string"
                  ? e
                  : "realtime connect failed";

        host.setLastError(msg);
        host.scheduleReconnect();
    } finally {
        if (generation === host.connectGeneration) {
            connectInFlight.value = false;
        }
    }
}
