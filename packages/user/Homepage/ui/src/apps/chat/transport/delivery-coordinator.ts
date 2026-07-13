import { chatDataRecord } from "../lib/chat-data-debug";

export type DeliveryLegState =
    | "queued"
    | "ensuring_peer"
    | "in_flight"
    | "acked"
    | "failed";

export type DeliveryLeg = {
    msgId: string;
    recipient: string;
    state: DeliveryLegState;
    attempts: number;
    lastError?: string;
};

export type SendAttemptResult =
    | { ok: true }
    | { ok: false; reason: string; retryable?: boolean };

export type DeliveryCoordinatorOptions = {
    ensurePeer: (remote: string) => Promise<void>;
    trySend: (msgId: string, recipient: string) => SendAttemptResult;
    onAcked: (msgId: string, recipient: string) => void;
    onFailed: (msgId: string, recipient: string, reason: string) => void;
    maxAttempts?: number;
};

export type DeliveryCoordinator = {
    enqueue: (msgId: string, recipient: string) => void;
    flushRemote: (remote: string) => Promise<void>;
    /** SoT for delivery leg state; L4 keeps ACK timers only. */
    markAcked: (msgId: string, recipient: string) => void;
    markFailed: (msgId: string, recipient: string, reason: string) => void;
    onAckTimeout: (msgId: string, recipient: string) => void;
    getLeg: (msgId: string, recipient: string) => DeliveryLeg | undefined;
    isFlushing: (remote: string) => boolean;
};

function legKey(msgId: string, recipient: string): string {
    return `${msgId}\0${recipient}`;
}

export function createDeliveryCoordinator(
    options: DeliveryCoordinatorOptions,
): DeliveryCoordinator {
    const maxAttempts = options.maxAttempts ?? 8;
    const legs = new Map<string, DeliveryLeg>();
    const flushingRemotes = new Set<string>();
    const flushChains = new Map<string, Promise<void>>();

    const getLeg = (msgId: string, recipient: string) =>
        legs.get(legKey(msgId, recipient));

    const setState = (
        msgId: string,
        recipient: string,
        state: DeliveryLegState,
        patch?: Partial<DeliveryLeg>,
    ) => {
        const key = legKey(msgId, recipient);
        const prev = legs.get(key);
        const next: DeliveryLeg = {
            msgId,
            recipient,
            attempts: 0,
            ...prev,
            state,
            ...patch,
        };
        legs.set(key, next);
        chatDataRecord("delivery-coordinator-state", {
            msgId,
            recipient,
            state,
            attempts: next.attempts,
        });
    };

    const enqueue = (msgId: string, recipient: string) => {
        const existing = getLeg(msgId, recipient);
        if (
            existing &&
            (existing.state === "in_flight" ||
                existing.state === "ensuring_peer" ||
                existing.state === "acked")
        ) {
            return;
        }
        setState(msgId, recipient, "queued");
    };

    const runFlush = async (remote: string) => {
        if (flushingRemotes.has(remote)) {
            return flushChains.get(remote) ?? Promise.resolve();
        }
        flushingRemotes.add(remote);
        const chain = (async () => {
            try {
                const pending = [...legs.values()].filter(
                    (l) =>
                        l.recipient === remote &&
                        (l.state === "queued" || l.state === "failed"),
                );
                if (pending.length === 0) return;

                for (const leg of pending) {
                    if (leg.attempts >= maxAttempts) {
                        setState(leg.msgId, leg.recipient, "failed", {
                            lastError: "max attempts exceeded",
                        });
                        options.onFailed(
                            leg.msgId,
                            leg.recipient,
                            "max attempts exceeded",
                        );
                        continue;
                    }
                    setState(leg.msgId, leg.recipient, "ensuring_peer", {
                        attempts: leg.attempts + 1,
                    });
                }

                await options.ensurePeer(remote);

                for (const leg of [...legs.values()].filter(
                    (l) =>
                        l.recipient === remote && l.state === "ensuring_peer",
                )) {
                    const result = options.trySend(leg.msgId, leg.recipient);
                    if (result.ok) {
                        setState(leg.msgId, leg.recipient, "in_flight");
                    } else if (result.retryable !== false) {
                        setState(leg.msgId, leg.recipient, "queued", {
                            lastError: result.reason,
                        });
                    } else {
                        setState(leg.msgId, leg.recipient, "failed", {
                            lastError: result.reason,
                        });
                        options.onFailed(
                            leg.msgId,
                            leg.recipient,
                            result.reason,
                        );
                    }
                }
            } finally {
                flushingRemotes.delete(remote);
                flushChains.delete(remote);
            }
        })();
        flushChains.set(remote, chain);
        return chain;
    };

    const flushRemote = (remote: string) => runFlush(remote);

    const markAcked = (msgId: string, recipient: string) => {
        setState(msgId, recipient, "acked");
        options.onAcked(msgId, recipient);
    };

    const markFailed = (msgId: string, recipient: string, reason: string) => {
        setState(msgId, recipient, "failed", { lastError: reason });
        options.onFailed(msgId, recipient, reason);
    };

    const onAckTimeout = (msgId: string, recipient: string) => {
        const leg = getLeg(msgId, recipient);
        if (!leg || leg.state !== "in_flight") return;
        setState(msgId, recipient, "queued", {
            lastError: "ack timeout",
        });
    };

    return {
        enqueue,
        flushRemote,
        markAcked,
        markFailed,
        onAckTimeout,
        getLeg,
        isFlushing: (remote) => flushingRemotes.has(remote),
    };
}
