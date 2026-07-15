import {
    avCallLog,
    shortSessionId,
    shortSpaceId,
} from "./av-call-debug";
import {
    AV_MAX_TRANSPORT_RECOVERY_ATTEMPTS,
    AV_TRANSPORT_RECOVERY_BASE_MS,
    AV_TRANSPORT_RECOVERY_MAX_MS,
    remoteMembers,
    type AvCallOrchestratorHost,
    type AvCallSpaceRun,
} from "./av-call-session-types";

/**
 * Per-run capped exponential-backoff scheduler for AV-call transport recovery.
 * Mirror of the chat-data `TransportRecoveryManager` pattern; AV uses the same
 * delay shape but tracks the timer in its own map to keep the two stacks
 * independent.
 */
export class AvCallTransportRecoveryManager {
    private readonly transportRecoveryTimers = new Map<
        AvCallSpaceRun,
        ReturnType<typeof globalThis.setTimeout>
    >();

    cancelTransportRecovery(run: AvCallSpaceRun): void {
        const timer = this.transportRecoveryTimers.get(run);
        if (timer != null) {
            globalThis.clearTimeout(timer);
            this.transportRecoveryTimers.delete(run);
        }
    }

    scheduleTransportRecovery(
        run: AvCallSpaceRun,
        host: AvCallOrchestratorHost,
    ): void {
        const sessionId = run.snapshot.sessionId;
        if (!sessionId) return;

        const nextAttempt = run.transportRecoveryAttempt + 1;
        if (nextAttempt > AV_MAX_TRANSPORT_RECOVERY_ATTEMPTS) {
            avCallLog("av-call transport recovery paused (max attempts)", {
                space: shortSpaceId(run.spaceUuid),
                sessionId: shortSessionId(sessionId),
                attempts: run.transportRecoveryAttempt,
            });
            run.transportRecoveryAttempt = 0;
            host.dispatchRunEventForRun?.(run, {
                type: "signalingDeferred",
                sessionId,
            });
            return;
        }
        run.transportRecoveryAttempt = nextAttempt;

        const delay = Math.min(
            AV_TRANSPORT_RECOVERY_MAX_MS,
            AV_TRANSPORT_RECOVERY_BASE_MS * 2 ** (nextAttempt - 1),
        );

        this.cancelTransportRecovery(run);
        avCallLog("av-call transport recovery scheduled", {
            space: shortSpaceId(run.spaceUuid),
            sessionId: shortSessionId(sessionId),
            attempt: nextAttempt,
            delayMs: delay,
        });
        const timer = globalThis.setTimeout(() => {
            this.transportRecoveryTimers.delete(run);
            const self = host.getSelf();
            if (run.kind === "group") {
                const anyOnline =
                    !!self &&
                    remoteMembers(run.members, self).some(
                        (m) => host.getPeerPresence()[m] === "online",
                    );
                if (!anyOnline) {
                    run.transportRecoveryAttempt = 0;
                    host.dispatchRunEventForRun?.(run, {
                        type: "signalingDeferred",
                        sessionId,
                    });
                    return;
                }
            } else if (host.getPeerPresence()[run.peerAccount] !== "online") {
                run.transportRecoveryAttempt = 0;
                host.dispatchRunEventForRun?.(run, {
                    type: "signalingDeferred",
                    sessionId,
                });
                return;
            }
            host.dispatchRunEventForRun?.(run, {
                type: "recoveryTick",
                sessionId,
            });
        }, delay);
        this.transportRecoveryTimers.set(run, timer);
    }

    dispose(): void {
        for (const timer of this.transportRecoveryTimers.values()) {
            globalThis.clearTimeout(timer);
        }
        this.transportRecoveryTimers.clear();
    }
}
