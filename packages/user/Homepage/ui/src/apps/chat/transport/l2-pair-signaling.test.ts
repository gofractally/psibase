import { describe, expect, it, vi } from "vitest";

import { createPairSignaling } from "./l2-pair-signaling";
import { pairSessionId } from "./pair-id";

function createL2Harness(local: string) {
    const joinSessions: string[] = [];
    const handlers = new Map<string, Set<(...args: unknown[]) => void>>();
    const realtime = {
        get isReady() {
            return true;
        },
        on(event: string, handler: (...args: unknown[]) => void) {
            const set = handlers.get(event) ?? new Set();
            set.add(handler);
            handlers.set(event, set);
            return () => set.delete(handler);
        },
        emit(event: string, ...args: unknown[]) {
            for (const h of handlers.get(event) ?? []) h(...args);
        },
    };
    const signaling = {
        joinSession: vi.fn((id: string) => {
            joinSessions.push(id);
        }),
        leaveSession: vi.fn(),
        signal: vi.fn(),
        flushDeferredSignals: vi.fn(),
        bindSessionJoinedGate: vi.fn(),
    };
    const joinedOnServer = new Map<string, boolean>();
    const pairSignaling = createPairSignaling({
        localAccount: local,
        realtime: realtime as never,
        signaling: signaling as never,
        isJoinedOnServer: (pairId) => joinedOnServer.get(pairId) === true,
    });
    return {
        pairSignaling,
        joinSessions,
        joinedOnServer,
        realtime,
        signaling,
    };
}

describe("l2-pair-signaling", () => {
    it("joinPair sends joinSession when ws ready", async () => {
        const { pairSignaling, joinSessions } = createL2Harness("alice");
        const pairId = pairSessionId("alice", "bob");

        pairSignaling.joinPair("alice", "bob");
        await Promise.resolve();

        expect(joinSessions).toEqual([pairId]);
    });

    it("applySessionSnapshot marks joined and emits pairJoined", async () => {
        const { pairSignaling } = createL2Harness("alice");
        const pairId = pairSessionId("alice", "bob");
        const joined = vi.fn();
        pairSignaling.on("pairJoined", joined);

        pairSignaling.joinPair("alice", "bob");
        await Promise.resolve();

        expect(pairSignaling.isJoined(pairId)).toBe(false);

        pairSignaling.applySessionSnapshot(pairId, ["alice", "bob"]);

        expect(pairSignaling.isJoined(pairId)).toBe(true);
        expect(joined).toHaveBeenCalledWith(pairId);
    });

    it("clears joined state when a later snapshot moves self back to pending", async () => {
        const { pairSignaling, joinedOnServer } = createL2Harness("alice");
        const pairId = pairSessionId("alice", "bob");

        pairSignaling.joinPair("alice", "bob");
        await Promise.resolve();
        pairSignaling.applySessionSnapshot(pairId, ["alice", "bob"]);
        joinedOnServer.set(pairId, true);

        expect(pairSignaling.isJoined(pairId)).toBe(true);

        joinedOnServer.set(pairId, false);
        pairSignaling.applySessionSnapshot(pairId, ["bob"]);

        expect(pairSignaling.isJoined(pairId)).toBe(false);
    });

    it("re-joins active pairs on welcome", () => {
        const { pairSignaling, joinSessions, realtime } = createL2Harness("alice");
        pairSignaling.joinPair("alice", "bob");
        joinSessions.length = 0;

        realtime.emit("welcome");
        realtime.emit("ready");

        expect(joinSessions).toEqual([pairSessionId("alice", "bob")]);
    });

    it("drains the next pair join once self appears on the server roster", async () => {
        vi.useFakeTimers();
        const { pairSignaling, joinSessions } = createL2Harness("alice");
        const bobPair = pairSessionId("alice", "bob");
        const carolPair = pairSessionId("alice", "carol");

        pairSignaling.joinPair("alice", "bob");
        pairSignaling.joinPair("alice", "carol");
        await Promise.resolve();

        expect(joinSessions).toEqual([bobPair]);

        pairSignaling.applySessionSnapshot(bobPair, ["alice"]);
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(50);
        expect(joinSessions).toEqual([bobPair, carolPair]);
        expect(pairSignaling.isJoined(bobPair)).toBe(false);

        pairSignaling.applySessionSnapshot(bobPair, ["alice", "bob"]);
        expect(pairSignaling.isJoined(bobPair)).toBe(true);
        vi.useRealTimers();
    });

    it("waits for sessionSnapshot before joining the next pair on the same socket", async () => {
        vi.useFakeTimers();
        const { pairSignaling, joinSessions } = createL2Harness("alice");
        const bobPair = pairSessionId("alice", "bob");
        const carolPair = pairSessionId("alice", "carol");

        pairSignaling.joinPair("alice", "bob");
        pairSignaling.joinPair("alice", "carol");
        await Promise.resolve();

        expect(joinSessions).toEqual([bobPair]);
        await vi.advanceTimersByTimeAsync(50);
        expect(joinSessions).toEqual([bobPair]);

        pairSignaling.applySessionSnapshot(bobPair, ["alice", "bob"]);
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(50);
        expect(joinSessions).toEqual([bobPair, carolPair]);
        vi.useRealTimers();
    });

    it("re-joins all active pairs after welcome", async () => {
        vi.useFakeTimers();
        const { pairSignaling, joinSessions, realtime } = createL2Harness("alice");
        const bobPair = pairSessionId("alice", "bob");
        const carolPair = pairSessionId("alice", "carol");

        pairSignaling.joinPair("alice", "bob");
        pairSignaling.joinPair("alice", "carol");
        await Promise.resolve();
        pairSignaling.applySessionSnapshot(bobPair, ["alice", "bob"]);
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(50);
        pairSignaling.applySessionSnapshot(carolPair, ["alice", "carol"]);
        joinSessions.length = 0;

        realtime.emit("welcome");
        realtime.emit("ready");
        await Promise.resolve();

        expect(joinSessions).toEqual([bobPair]);
        pairSignaling.applySessionSnapshot(bobPair, ["alice", "bob"]);
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(50);
        expect(joinSessions).toEqual([bobPair, carolPair]);
        vi.useRealTimers();
    });

    it("re-joins after welcome when pair was registered via sessionSnapshot only", () => {
        const { pairSignaling, joinSessions, realtime } = createL2Harness("alice");
        const pairId = pairSessionId("alice", "bob");

        pairSignaling.applySessionSnapshot(pairId, ["alice", "bob"]);
        joinSessions.length = 0;

        realtime.emit("welcome");
        realtime.emit("ready");

        expect(joinSessions).toEqual([pairId]);
    });

    it("re-joins after welcome when server roster gate still shows joined", () => {
        const { pairSignaling, joinSessions, realtime, joinedOnServer } =
            createL2Harness("alice");
        const pairId = pairSessionId("alice", "bob");

        pairSignaling.joinPair("alice", "bob");
        pairSignaling.applySessionSnapshot(pairId, ["alice", "bob"]);
        joinedOnServer.set(pairId, true);
        joinSessions.length = 0;

        realtime.emit("welcome");
        realtime.emit("ready");

        expect(joinSessions).toEqual([pairId]);
    });
});
