import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
    clearInboundAcceptanceQueue,
    enqueueInboundAcceptance,
    loadInboundAcceptanceQueue,
} from "./inbound-acceptance-queue";
import { inboundMessageAcceptance } from "./inbound-message-acceptance";

describe("inboundMessageAcceptance", () => {
    it("defers when contacts are not loaded", () => {
        expect(
            inboundMessageAcceptance("alice", "bob", new Set(), false),
        ).toBe("deferred_contacts");
    });

    it("rejects unknown contacts when loaded", () => {
        expect(
            inboundMessageAcceptance("alice", "bob", new Set(["carol"]), true),
        ).toBe("rejected");
    });

    it("accepts known contacts when loaded", () => {
        expect(
            inboundMessageAcceptance("alice", "bob", new Set(["bob"]), true),
        ).toBe("accepted");
    });
});

describe("inbound-acceptance-queue", () => {
    beforeEach(() => {
        localStorage.clear();
    });

    afterEach(() => {
        localStorage.clear();
    });

    it("persists and dedupes acceptance records", () => {
        const record = {
            remote: "bob",
            spaceUuid: "space:group",
            clientMsgId: "msg-1",
            from: "bob",
            body: "hello",
            sendTimestamp: 900,
            receivedAt: 1000,
        };
        enqueueInboundAcceptance("chain", "alice", record);
        enqueueInboundAcceptance("chain", "alice", record);
        expect(loadInboundAcceptanceQueue("chain", "alice")).toEqual([record]);
    });

    it("clear returns and empties the queue", () => {
        enqueueInboundAcceptance("chain", "alice", {
            remote: "bob",
            spaceUuid: "space:dm",
            clientMsgId: "msg-2",
            from: "bob",
            body: "hi",
            sendTimestamp: 1900,
            receivedAt: 2000,
        });
        const drained = clearInboundAcceptanceQueue("chain", "alice");
        expect(drained).toHaveLength(1);
        expect(loadInboundAcceptanceQueue("chain", "alice")).toEqual([]);
    });
});
