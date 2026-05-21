import { chatDataLog, shortSessionId, shortSpaceId } from "./chat-data-debug";
import {
    MAX_TRANSPORT_RECOVERY_ATTEMPTS,
    TRANSPORT_RECOVERY_BASE_MS,
    TRANSPORT_RECOVERY_MAX_MS,
    TRANSPORT_RECOVERY_PRESENCE_ONLINE_BASE_MS,
    remoteMembers,
    type ChatDataOrchestratorHost,
    type SpaceRun,
} from "./chat-data-session-types";

export class TransportRecoveryManager {
    private readonly transportRecoveryTimers = new Map<
        SpaceRun,
        ReturnType<typeof globalThis.setTimeout>
    >();

    cancelTransportRecovery(run: SpaceRun): void {
        const timer = this.transportRecoveryTimers.get(run);
        if (timer != null) {
            globalThis.clearTimeout(timer);
            this.transportRecoveryTimers.delete(run);
        }
    }

    scheduleTransportRecovery(
        run: SpaceRun,
        host: ChatDataOrchestratorHost,
    ): void {
        // Forward declaration: defined as a module-private helper below.
        const sessionId = run.snapshot.sessionId;
        if (!sessionId) return;

        const nextAttempt = run.transportRecoveryAttempt + 1;
        if (nextAttempt > MAX_TRANSPORT_RECOVERY_ATTEMPTS) {
            chatDataLog("transport recovery paused (max attempts)", {
                space: shortSpaceId(run.spaceUuid),
                sessionId: shortSessionId(sessionId),
                attempts: run.transportRecoveryAttempt,
            });
            run.transportRecoveryAttempt = 0;
            host.dispatchRunEventForRun(run, {
                type: "signalingDeferred",
                sessionId,
            });
            return;
        }
        run.transportRecoveryAttempt = nextAttempt;

        // Plan F7: tighter baseline when at least one remote member is
        // still presence-online — that case is overwhelmingly a transient
        // SCTP/ICE hiccup that recovers within a single RTT. The slower
        // 2s baseline is reserved for "the remote tab is gone" cases
        // where there's no point hammering.
        const anyRemoteOnline = anyOnlineRemote(run, host);
        const baseMs = anyRemoteOnline
            ? TRANSPORT_RECOVERY_PRESENCE_ONLINE_BASE_MS
            : TRANSPORT_RECOVERY_BASE_MS;
        const delay = Math.min(
            TRANSPORT_RECOVERY_MAX_MS,
            baseMs * 2 ** (nextAttempt - 1),
        );

        this.cancelTransportRecovery(run);
        chatDataLog("transport recovery scheduled", {
            space: shortSpaceId(run.spaceUuid),
            sessionId: shortSessionId(sessionId),
            attempt: nextAttempt,
            delayMs: delay,
        });
        const timer = globalThis.setTimeout(() => {
            this.transportRecoveryTimers.delete(run);
            if (run.kind === "group") {
                const self = host.getSelf();
                const anyOnline =
                    !!self &&
                    remoteMembers(run.members, self).some(
                        (m) => host.getPeerPresence()[m] === "online",
                    );
                if (!anyOnline) {
                    run.transportRecoveryAttempt = 0;
                    host.dispatchRunEventForRun(run, {
                        type: "signalingDeferred",
                        sessionId,
                    });
                    return;
                }
            } else if (host.getPeerPresence()[run.peerAccount] !== "online") {
                run.transportRecoveryAttempt = 0;
                host.dispatchRunEventForRun(run, {
                    type: "signalingDeferred",
                    sessionId,
                });
                return;
            }
            host.dispatchRunEventForRun(run, {
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

function anyOnlineRemote(
    run: SpaceRun,
    host: ChatDataOrchestratorHost,
): boolean {
    const self = host.getSelf();
    if (!self) return false;
    const presence = host.getPeerPresence();
    if (run.kind === "dm") return presence[run.peerAccount] === "online";
    return remoteMembers(run.members, self).some(
        (m) => presence[m] === "online",
    );
}
