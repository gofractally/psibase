import { describe, expect, it, vi } from "vitest";

import {
    createNegotiationScheduler,
    ENSURE_REASON_PRIORITY,
} from "./negotiation-scheduler";

describe("negotiation-scheduler", () => {
    it("runs high-priority work before low-priority when at capacity", () => {
        const order: string[] = [];
        const scheduler = createNegotiationScheduler({ maxConcurrent: 1 });

        scheduler.schedule("alice", "roster_kick", () => {
            order.push("alice-kick");
        });
        expect(order).toEqual(["alice-kick"]);

        scheduler.schedule("bob", "message_enqueued", () => {
            order.push("bob-msg");
        });
        expect(order).toEqual(["alice-kick"]);
        expect(scheduler.queueLength()).toBe(1);

        scheduler.release("alice");
        expect(order).toEqual(["alice-kick", "bob-msg"]);
    });

    it("defers roster kicks while a handshake is in flight", () => {
        const scheduler = createNegotiationScheduler();
        scheduler.schedule("bob", "peer_focus", () => {});
        expect(
            scheduler.shouldDeferKick("bob", "negotiating"),
        ).toBe(true);
        expect(
            scheduler.shouldDeferKick("bob", "usable"),
        ).toBe(false);
    });

    it("prioritizes message_enqueued over roster_kick", () => {
        expect(ENSURE_REASON_PRIORITY.message_enqueued).toBeGreaterThan(
            ENSURE_REASON_PRIORITY.roster_kick,
        );
    });

    it("upgrades queued reason when a higher priority ensure arrives", () => {
        const runs: Array<{ remote: string; reason: string }> = [];
        const scheduler = createNegotiationScheduler({ maxConcurrent: 1 });
        scheduler.schedule("alice", "roster_kick", () => {
            runs.push({ remote: "alice", reason: "kick" });
        });
        scheduler.schedule("bob", "roster_kick", () => {
            runs.push({ remote: "bob", reason: "kick" });
        });
        scheduler.schedule("bob", "message_enqueued", () => {
            runs.push({ remote: "bob", reason: "msg" });
        });
        scheduler.release("alice");
        expect(runs.at(-1)).toEqual({ remote: "bob", reason: "msg" });
    });
});

describe("delivery-coordinator", () => {
    it("walks queued -> ensuring_peer -> in_flight on flush", async () => {
        const { createDeliveryCoordinator } = await import(
            "./delivery-coordinator"
        );
        const ensurePeer = vi.fn(async () => {});
        const trySend = vi
            .fn()
            .mockReturnValueOnce({ ok: true as const })
            .mockReturnValueOnce({ ok: false, reason: "peer_not_ready", retryable: true });
        const onAcked = vi.fn();
        const onFailed = vi.fn();

        const coordinator = createDeliveryCoordinator({
            ensurePeer,
            trySend,
            onAcked,
            onFailed,
        });

        coordinator.enqueue("m1", "bob");
        coordinator.enqueue("m2", "bob");
        await coordinator.flushRemote("bob");

        expect(ensurePeer).toHaveBeenCalledWith("bob");
        expect(trySend).toHaveBeenCalledTimes(2);
        expect(coordinator.getLeg("m1", "bob")?.state).toBe("in_flight");
        expect(coordinator.getLeg("m2", "bob")?.state).toBe("queued");
    });

    it("marks acked and failed legs", async () => {
        const { createDeliveryCoordinator } = await import(
            "./delivery-coordinator"
        );
        const coordinator = createDeliveryCoordinator({
            ensurePeer: vi.fn(async () => {}),
            trySend: vi.fn(() => ({ ok: true as const })),
            onAcked: vi.fn(),
            onFailed: vi.fn(),
        });

        coordinator.enqueue("m1", "bob");
        await coordinator.flushRemote("bob");
        coordinator.markAcked("m1", "bob");
        expect(coordinator.getLeg("m1", "bob")?.state).toBe("acked");

        coordinator.enqueue("m2", "bob");
        coordinator.markFailed("m2", "bob", "nope");
        expect(coordinator.getLeg("m2", "bob")?.state).toBe("failed");
    });

    it("requeues in_flight legs on ack timeout", async () => {
        const { createDeliveryCoordinator } = await import(
            "./delivery-coordinator"
        );
        const trySend = vi.fn(() => ({ ok: true as const }));
        const coordinator = createDeliveryCoordinator({
            ensurePeer: vi.fn(async () => {}),
            trySend,
            onAcked: vi.fn(),
            onFailed: vi.fn(),
        });

        coordinator.enqueue("m1", "bob");
        await coordinator.flushRemote("bob");
        coordinator.onAckTimeout("m1", "bob");
        expect(coordinator.getLeg("m1", "bob")?.state).toBe("queued");
        await coordinator.flushRemote("bob");
        expect(trySend).toHaveBeenCalledTimes(2);
    });
});
