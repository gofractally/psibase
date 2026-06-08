import { describe, expect, it } from "vitest";

import { listInboundAckTargets } from "./inbound-message-ack";

describe("listInboundAckTargets", () => {
    it("returns ack targets for other senders with clientMsgId", () => {
        const targets = listInboundAckTargets(
            [
                {
                    from: "alice",
                    spaceUuid: "space:group",
                    clientMsgId: "msg-1",
                },
                {
                    from: "bob",
                    spaceUuid: "space:group",
                    clientMsgId: "msg-2",
                },
                {
                    from: "carol",
                    spaceUuid: "space:group",
                },
            ],
            "self",
        );
        expect(targets).toEqual([
            {
                remote: "alice",
                spaceUuid: "space:group",
                clientMsgId: "msg-1",
            },
            {
                remote: "bob",
                spaceUuid: "space:group",
                clientMsgId: "msg-2",
            },
        ]);
    });

    it("dedupes repeated history-sync rows", () => {
        const row = {
            from: "alice",
            spaceUuid: "space:group",
            clientMsgId: "msg-1",
        };
        expect(listInboundAckTargets([row, row], "self")).toEqual([
            {
                remote: "alice",
                spaceUuid: "space:group",
                clientMsgId: "msg-1",
            },
        ]);
    });

    it("skips self-authored rows", () => {
        expect(
            listInboundAckTargets(
                [
                    {
                        from: "self",
                        spaceUuid: "space:group",
                        clientMsgId: "msg-self",
                    },
                ],
                "self",
            ),
        ).toEqual([]);
    });
});
