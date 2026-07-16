import { chatDataRecord, shortSessionId } from "./chat-data-debug";

import { WebRtcSignalingClient as SharedWebRtcSignalingClient } from "@shared/domains/webrtc/lib/webrtc-signaling-client";
import type { RealtimeClient } from "@shared/domains/webrtc/lib/realtime-client";
import type { OutboundSignal } from "@shared/domains/webrtc/lib/webrtc-signaling-client";

export type {
    OutboundSignal,
    SignalKind,
    WebRtcSignalingClientOptions,
} from "@shared/domains/webrtc/lib/webrtc-signaling-client";

/**
 * Chat-local signaling client with chat-data debug logging.
 * Intentionally kept chat-local (not moved to shared-ui): it adds the
 * session-joined deferred-signal gate that only the chat transport stack needs.
 */
export class WebRtcSignalingClient extends SharedWebRtcSignalingClient {
    private sessionJoinedGate: ((sessionId: string) => boolean) | null = null;

    private readonly deferredSignals = new Map<string, OutboundSignal[]>();

    constructor(realtime: RealtimeClient) {
        super(realtime, {
            debugLog: (event, detail) => chatDataRecord(event, detail),
            shortSessionId,
        });
    }

    /** Drop outbound signals until the server roster confirms join. */
    bindSessionJoinedGate(gate: (sessionId: string) => boolean): void {
        this.sessionJoinedGate = gate;
    }

    /** Send any signals queued while waiting for server join confirmation. */
    flushDeferredSignals(sessionId: string): void {
        const queued = this.deferredSignals.get(sessionId);
        if (!queued?.length) return;
        this.deferredSignals.delete(sessionId);
        chatDataRecord("signal deferred: flush", {
            sessionId: shortSessionId(sessionId),
            count: queued.length,
        });
        for (const payload of queued) {
            super.signal(payload);
        }
    }

    override signal(payload: OutboundSignal): void {
        if (
            this.sessionJoinedGate &&
            !this.sessionJoinedGate(payload.sessionId)
        ) {
            const queue =
                this.deferredSignals.get(payload.sessionId) ?? [];
            queue.push(payload);
            this.deferredSignals.set(payload.sessionId, queue);
            chatDataRecord("signal deferred: not joined", {
                sessionId: shortSessionId(payload.sessionId),
                to: payload.to,
                kind: payload.kind,
                queued: queue.length,
            });
            return;
        }
        super.signal(payload);
    }
}
