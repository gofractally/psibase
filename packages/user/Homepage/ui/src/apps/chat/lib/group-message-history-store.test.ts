import { describe, expect, it } from "vitest";

import {
    buildGroupEnvelope,
    mergeGroupEnvelopesBySendTimestamp,
    type GroupMessageEnvelope,
} from "./group-message-history-store";

function env(input: {
    localId: string;
    from: string;
    body: string;
    sendTimestamp: number;
    clientMsgId?: string;
    serverMsgId?: number;
}): GroupMessageEnvelope {
    return buildGroupEnvelope({
        ownerAccount: "alice",
        spaceUuid: "space:abc",
        from: input.from,
        body: input.body,
        sendTimestamp: input.sendTimestamp,
        clientMsgId: input.clientMsgId,
        serverMsgId: input.serverMsgId,
        fallbackKey: input.localId,
    });
}

describe("mergeGroupEnvelopesBySendTimestamp", () => {
    it("sorts by sendTimestamp ascending", () => {
        const merged = mergeGroupEnvelopesBySendTimestamp([
            env({ localId: "b", from: "bob", body: "2", sendTimestamp: 200 }),
            env({ localId: "a", from: "alice", body: "1", sendTimestamp: 100 }),
        ]);
        expect(merged.map((row) => row.sendTimestamp)).toEqual([100, 200]);
    });

    it("dedupes by clientMsgId and keeps earliest sendTimestamp", () => {
        const merged = mergeGroupEnvelopesBySendTimestamp(
            [
                env({
                    localId: "a",
                    from: "alice",
                    body: "first",
                    sendTimestamp: 100,
                    clientMsgId: "c1",
                }),
            ],
            [
                env({
                    localId: "b",
                    from: "alice",
                    body: "duplicate",
                    sendTimestamp: 50,
                    clientMsgId: "c1",
                }),
            ],
        );
        expect(merged).toHaveLength(1);
        expect(merged[0].body).toBe("duplicate");
        expect(merged[0].sendTimestamp).toBe(50);
        expect(merged[0].localId).toBe("c1");
    });

    it("dedupes by serverMsgId", () => {
        const merged = mergeGroupEnvelopesBySendTimestamp(
            [
                env({
                    localId: "a",
                    from: "alice",
                    body: "local",
                    sendTimestamp: 100,
                    serverMsgId: 7,
                }),
            ],
            [
                env({
                    localId: "b",
                    from: "alice",
                    body: "confirmed",
                    sendTimestamp: 90,
                    serverMsgId: 7,
                }),
            ],
        );
        expect(merged).toHaveLength(1);
        expect(merged[0].body).toBe("confirmed");
        expect(merged[0].sendTimestamp).toBe(90);
    });

    it("handles out-of-order delivery batches from mesh peers", () => {
        const fromAlice = env({
            localId: "a1",
            from: "alice",
            body: "A offline msg",
            sendTimestamp: 150,
            clientMsgId: "a-offline",
        });
        const fromBob = env({
            localId: "b1",
            from: "bob",
            body: "B reply",
            sendTimestamp: 250,
            clientMsgId: "b-reply",
        });
        const merged = mergeGroupEnvelopesBySendTimestamp([fromBob], [fromAlice]);
        expect(merged.map((row) => row.from)).toEqual(["alice", "bob"]);
    });
});
