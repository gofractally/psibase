import { describe, expect, it } from "vitest";

import {
    buildDmEnvelope,
    mergeEnvelopesBySendTimestamp,
    type DmMessageEnvelope,
} from "./dm-message-history-store";

function env(input: {
    localId: string;
    from: string;
    body: string;
    sendTimestamp: number;
    clientMsgId?: string;
    serverMsgId?: number;
}): DmMessageEnvelope {
    return buildDmEnvelope({
        ownerAccount: "alice",
        spaceUuid: "space:dm",
        peerAccount: "bob",
        from: input.from,
        body: input.body,
        sendTimestamp: input.sendTimestamp,
        clientMsgId: input.clientMsgId,
        serverMsgId: input.serverMsgId,
        fallbackKey: input.localId,
    });
}

describe("mergeEnvelopesBySendTimestamp (DM)", () => {
    it("dedupes duplicate inbound clientMsgId and keeps earliest sendTimestamp", () => {
        const merged = mergeEnvelopesBySendTimestamp(
            [
                env({
                    localId: "a",
                    from: "bob",
                    body: "first",
                    sendTimestamp: 100,
                    clientMsgId: "dup-1",
                }),
            ],
            [
                env({
                    localId: "b",
                    from: "bob",
                    body: "duplicate wire",
                    sendTimestamp: 50,
                    clientMsgId: "dup-1",
                }),
            ],
        );
        expect(merged).toHaveLength(1);
        expect(merged[0]!.body).toBe("duplicate wire");
        expect(merged[0]!.sendTimestamp).toBe(50);
        expect(merged[0]!.clientMsgId).toBe("dup-1");
        expect(merged[0]!.localId).toBe("dup-1");
    });

    it("dedupes by serverMsgId", () => {
        const merged = mergeEnvelopesBySendTimestamp(
            [
                env({
                    localId: "a",
                    from: "bob",
                    body: "local",
                    sendTimestamp: 100,
                    serverMsgId: 7,
                }),
            ],
            [
                env({
                    localId: "b",
                    from: "bob",
                    body: "confirmed",
                    sendTimestamp: 110,
                    serverMsgId: 7,
                }),
            ],
        );
        expect(merged).toHaveLength(1);
        expect(merged[0]!.serverMsgId).toBe(7);
    });
});
