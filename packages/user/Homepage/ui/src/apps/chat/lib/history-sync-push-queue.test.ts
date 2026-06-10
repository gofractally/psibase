import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
    enqueueHistorySyncPush,
    historySyncPushForPeer,
    loadHistorySyncPushQueue,
} from "./history-sync-push-queue";

describe("history-sync-push-queue", () => {
    beforeEach(() => {
        localStorage.clear();
    });

    afterEach(() => {
        localStorage.clear();
    });

    it("persists and dedupes push records", () => {
        const record = {
            peerAccount: "bob",
            spaceUuid: "space:group",
            kind: "group" as const,
            enqueuedAt: 1000,
        };
        enqueueHistorySyncPush("chain", "alice", record);
        enqueueHistorySyncPush("chain", "alice", record);
        expect(loadHistorySyncPushQueue("chain", "alice")).toEqual([record]);
    });

    it("filters by peer account", () => {
        enqueueHistorySyncPush("chain", "alice", {
            peerAccount: "bob",
            spaceUuid: "space:a",
            kind: "dm",
            enqueuedAt: 1,
        });
        enqueueHistorySyncPush("chain", "alice", {
            peerAccount: "carol",
            spaceUuid: "space:b",
            kind: "group",
            enqueuedAt: 2,
        });
        expect(historySyncPushForPeer("chain", "alice", "bob")).toHaveLength(1);
    });
});
