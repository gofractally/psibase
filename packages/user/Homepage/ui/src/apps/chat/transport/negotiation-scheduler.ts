import { chatDataRecord } from "../lib/chat-data-debug";
import type { EnsureReason, PeerState } from "./types";

/** Higher priority runs before lower when slots are contended. */
export const ENSURE_REASON_PRIORITY: Record<EnsureReason, number> = {
    message_enqueued: 100,
    meet_start: 90,
    peer_focus: 80,
    peer_joined: 70,
    presence_online: 60,
    manual: 50,
    ws_ready: 40,
    roster_kick: 10,
};

export type NegotiationSchedulerOptions = {
    /** Max peers in join/negotiate flight at once (excluding `usable`). */
    maxConcurrent?: number;
};

type QueueItem = {
    remote: string;
    reason: EnsureReason;
    priority: number;
    run: () => void;
};

export type NegotiationScheduler = {
    /** Request negotiation; returns false when deferred to the queue. */
    schedule: (
        remote: string,
        reason: EnsureReason,
        run: () => void,
    ) => boolean;
    /** Release a slot after `usable`, dispose, or recover. */
    release: (remote: string) => void;
    isActive: (remote: string) => boolean;
    activeCount: () => number;
    queueLength: () => number;
    /** Low-priority kicks defer while a handshake is in flight. */
    shouldDeferKick: (remote: string, state: PeerState) => boolean;
};

const DEFAULT_MAX_CONCURRENT = 2;

export function createNegotiationScheduler(
    options?: NegotiationSchedulerOptions,
): NegotiationScheduler {
    const maxConcurrent = options?.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
    const activeRemotes = new Set<string>();
    const queue: QueueItem[] = [];

    const drain = () => {
        queue.sort((a, b) => b.priority - a.priority);
        while (
            activeRemotes.size < maxConcurrent &&
            queue.length > 0
        ) {
            const next = queue.shift()!;
            if (activeRemotes.has(next.remote)) {
                continue;
            }
            activeRemotes.add(next.remote);
            chatDataRecord("negotiation-scheduler-start", {
                remote: next.remote,
                reason: next.reason,
                priority: next.priority,
                active: activeRemotes.size,
                queued: queue.length,
            });
            next.run();
        }
    };

    const schedule = (
        remote: string,
        reason: EnsureReason,
        run: () => void,
    ): boolean => {
        const priority = ENSURE_REASON_PRIORITY[reason];
        if (activeRemotes.has(remote)) {
            chatDataRecord("negotiation-scheduler-coalesce", {
                remote,
                reason,
                priority,
            });
            return true;
        }
        if (activeRemotes.size >= maxConcurrent) {
            const existingIx = queue.findIndex((q) => q.remote === remote);
            if (existingIx >= 0) {
                const existing = queue[existingIx]!;
                if (priority > existing.priority) {
                    queue[existingIx] = { remote, reason, priority, run };
                }
            } else {
                queue.push({ remote, reason, priority, run });
            }
            chatDataRecord("negotiation-scheduler-defer", {
                remote,
                reason,
                priority,
                active: activeRemotes.size,
                queued: queue.length,
            });
            return false;
        }
        activeRemotes.add(remote);
        chatDataRecord("negotiation-scheduler-start", {
            remote,
            reason,
            priority,
            active: activeRemotes.size,
            queued: queue.length,
        });
        run();
        return true;
    };

    const release = (remote: string) => {
        if (!activeRemotes.delete(remote)) return;
        chatDataRecord("negotiation-scheduler-release", {
            remote,
            active: activeRemotes.size,
            queued: queue.length,
        });
        drain();
    };

    const shouldDeferKick = (remote: string, state: PeerState): boolean => {
        if (!activeRemotes.has(remote)) return false;
        return (
            state === "joining_pair" ||
            state === "negotiating" ||
            state === "waiting_ws"
        );
    };

    return {
        schedule,
        release,
        isActive: (remote) => activeRemotes.has(remote),
        activeCount: () => activeRemotes.size,
        queueLength: () => queue.length,
        shouldDeferKick,
    };
}
