import type { RealtimeHandlers } from "./realtime-handlers";
import type { ServerRealtimeFrame } from "./realtime-protocol";
import { realtimeTraceLog } from "./realtime-trace";

export type FrameDispatchHooks = {
    handlers: RealtimeHandlers;
    debugLog?: (event: string, detail?: Record<string, unknown>) => void;
    onWelcome: (frame: Extract<ServerRealtimeFrame, { t: "welcome" }>) => void;
    onFrame?: (frame: ServerRealtimeFrame) => void;
};

/** Route a parsed server frame to handlers and optional debug logging. */
export function dispatchServerFrame(
    frame: ServerRealtimeFrame,
    hooks: FrameDispatchHooks,
): void {
    switch (frame.t) {
        case "welcome":
            hooks.onWelcome(frame);
            hooks.handlers.welcome?.(frame);
            break;
        case "presenceSnapshot":
            hooks.handlers.presenceSnapshot?.(frame);
            break;
        case "presence":
            hooks.handlers.presence?.(frame);
            break;
        case "error":
            if (frame.code === "signal-trace") {
                realtimeTraceLog("ws ← signal-trace (ignored)", {
                    reason: frame.reason,
                    sessionId: frame.sessionId,
                });
                break;
            }
            hooks.debugLog?.("ws ← error", {
                code: frame.code,
                reason: frame.reason,
                sessionId: frame.sessionId,
            });
            hooks.handlers.error?.(frame);
            break;
        case "pong":
            hooks.handlers.pong?.(frame);
            break;
        case "sessionInvite":
            hooks.debugLog?.("ws ← sessionInvite", {
                sessionId: frame.sessionId,
                from: frame.from,
                purpose: frame.purpose,
            });
            hooks.handlers.sessionInvite?.(frame);
            break;
        case "participantJoined":
            hooks.debugLog?.("ws ← participantJoined", {
                sessionId: frame.sessionId,
                participant: frame.participant,
            });
            hooks.handlers.participantJoined?.(frame);
            break;
        case "participantState":
            hooks.handlers.participantState?.(frame);
            break;
        case "signal":
            hooks.debugLog?.("ws ← signal", {
                kind: frame.kind,
                from: frame.from,
                to: frame.to,
                sessionId: frame.sessionId,
            });
            hooks.handlers.signal?.(frame);
            break;
        case "sessionEnded":
            hooks.handlers.sessionEnded?.(frame);
            break;
        case "sessionSnapshot":
            hooks.debugLog?.("ws ← sessionSnapshot", {
                sessionId: frame.sessionId,
                epoch: frame.epoch,
                joined: frame.joinedParticipants,
                pending: frame.pendingParticipants,
            });
            hooks.handlers.sessionSnapshot?.(frame);
            break;
        case "transportLost":
            hooks.debugLog?.("ws ← transportLost", {
                sessionId: frame.sessionId,
                participant: frame.participant,
            });
            hooks.handlers.transportLost?.(frame);
            break;
        default:
            break;
    }

    hooks.onFrame?.(frame);
}
