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
    return { pairSignaling, joinSessions, joinedOnServer, realtime, signaling };
}

describe("l2-pair-signaling", () => {
    it("joinPair sends joinSession when ws ready", () => {
        const { pairSignaling, joinSessions } = createL2Harness("alice");
        const pairId = pairSessionId("alice", "bob");

        pairSignaling.joinPair("alice", "bob");

        expect(joinSessions).toEqual([pairId]);
    });

    it("applySessionSnapshot marks joined and emits pairJoined", () => {
        const { pairSignaling } = createL2Harness("alice");
        const pairId = pairSessionId("alice", "bob");
        const joined = vi.fn();
        pairSignaling.on("pairJoined", joined);

        pairSignaling.joinPair("alice", "bob");
        expect(pairSignaling.isJoined(pairId)).toBe(false);

        pairSignaling.applySessionSnapshot(pairId, ["alice", "bob"]);

        expect(pairSignaling.isJoined(pairId)).toBe(true);
        expect(joined).toHaveBeenCalledWith(pairId);
    });

    it("re-joins active pairs on welcome", () => {
        const { pairSignaling, joinSessions, realtime } = createL2Harness("alice");
        pairSignaling.joinPair("alice", "bob");
        joinSessions.length = 0;

        realtime.emit("welcome");

        expect(joinSessions).toEqual([pairSessionId("alice", "bob")]);
    });
});
