import { beforeEach, describe, expect, it } from "vitest";

import {
    inferDeliveryOpenPeersFromGroupHistory,
    inferDeliveryOpenPeersFromPendingDelivered,
    seedDeliveryOpenPeersFromGroupHistory,
    type GroupSpaceMembers,
} from "./delivery-open-peers";
import {
    buildGroupEnvelope,
    type GroupMessageEnvelope,
} from "./group-message-history-store";

const CHAIN = "chain:test";
const OWNER = "alice";
const SPACE = "space:abc";
const MEMBERS: GroupSpaceMembers = {
    spaceUuid: SPACE,
    members: ["alice", "bob", "carol"],
};

function groupEnv(input: {
    from: string;
    body: string;
    sendTimestamp: number;
    clientMsgId?: string;
    serverMsgId?: number;
}): GroupMessageEnvelope {
    return buildGroupEnvelope({
        ownerAccount: OWNER,
        spaceUuid: SPACE,
        from: input.from,
        body: input.body,
        sendTimestamp: input.sendTimestamp,
        clientMsgId: input.clientMsgId,
        serverMsgId: input.serverMsgId,
    });
}

beforeEach(() => {
    globalThis.localStorage.clear();
});

describe("inferDeliveryOpenPeersFromGroupHistory", () => {
    it("opens peers on inbound group messages", () => {
        const open = inferDeliveryOpenPeersFromGroupHistory(
            OWNER,
            [groupEnv({ from: "bob", body: "hi", sendTimestamp: 1 })],
            [MEMBERS],
        );
        expect(open).toEqual(["bob"]);
    });

    it("opens all other members when outbound message is confirmed", () => {
        const open = inferDeliveryOpenPeersFromGroupHistory(
            OWNER,
            [
                groupEnv({
                    from: OWNER,
                    body: "hello group",
                    sendTimestamp: 2,
                    clientMsgId: "c1",
                    serverMsgId: 42,
                }),
            ],
            [MEMBERS],
        );
        expect(open).toEqual(["bob", "carol"]);
    });

    it("skips outbound peers still in pending queue", () => {
        const open = inferDeliveryOpenPeersFromGroupHistory(
            OWNER,
            [
                groupEnv({
                    from: OWNER,
                    body: "pending",
                    sendTimestamp: 3,
                    clientMsgId: "pending-1",
                }),
            ],
            [MEMBERS],
            { pendingClientMsgIds: new Set(["pending-1"]) },
        );
        expect(open).toEqual([]);
    });

    it("treats outbound without clientMsgId as confirmed", () => {
        const open = inferDeliveryOpenPeersFromGroupHistory(
            OWNER,
            [
                groupEnv({
                    from: OWNER,
                    body: "no id",
                    sendTimestamp: 4,
                }),
            ],
            [MEMBERS],
        );
        expect(open).toEqual(["bob", "carol"]);
    });
});

describe("inferDeliveryOpenPeersFromPendingDelivered", () => {
    it("collects peers from per-peer pending deliveredTo rows", () => {
        const open = inferDeliveryOpenPeersFromPendingDelivered([
            { deliveredTo: ["bob"] },
            { deliveredTo: ["carol", "bob"] },
        ]);
        expect(open).toEqual(["bob", "carol"]);
    });
});

describe("seedDeliveryOpenPeersFromGroupHistory", () => {
    it("seeds localStorage from history and pending delivered rows", () => {
        const added = seedDeliveryOpenPeersFromGroupHistory(
            CHAIN,
            OWNER,
            [groupEnv({ from: "bob", body: "in", sendTimestamp: 1 })],
            [MEMBERS],
            {
                pendingDeliveredTo: [{ deliveredTo: ["carol"] }],
            },
        );
        expect(added).toBe(2);
        const again = seedDeliveryOpenPeersFromGroupHistory(
            CHAIN,
            OWNER,
            [groupEnv({ from: "bob", body: "in", sendTimestamp: 1 })],
            [MEMBERS],
            {
                pendingDeliveredTo: [{ deliveredTo: ["carol"] }],
            },
        );
        expect(again).toBe(0);
    });
});
