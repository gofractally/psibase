import { describe, expect, it } from "vitest";

import type { ChatHistorySyncEnvelope } from "./chat-data-envelope";
import {
    historySyncToGroupEnvelopes,
    resolveGroupMembersForHistorySync,
    shouldPushGroupHistoryOnConnect,
} from "./group-history-sync";

describe("shouldPushGroupHistoryOnConnect", () => {
    it("pushes history for late joiners and returning members", () => {
        expect(shouldPushGroupHistoryOnConnect(false)).toBe(true);
        expect(shouldPushGroupHistoryOnConnect(true)).toBe(false);
        expect(
            shouldPushGroupHistoryOnConnect(true, {
                peerIsOnlineNow: true,
                hadOpenDataChannel: true,
            }),
        ).toBe(true);
    });
});

describe("historySyncToGroupEnvelopes", () => {
    it("maps sync messages into durable group envelopes", () => {
        const sync: ChatHistorySyncEnvelope = {
            t: "chatHistorySync",
            spaceUuid: "space:abc",
            messages: [
                {
                    from: "alice",
                    body: "hello",
                    sendTimestamp: 100,
                    clientMsgId: "c1",
                },
                {
                    from: "bob",
                    body: "world",
                    sendTimestamp: 200,
                    clientMsgId: "c2",
                },
            ],
        };

        const envelopes = historySyncToGroupEnvelopes(
            "carol",
            "space:abc",
            sync,
        );

        expect(envelopes).toHaveLength(2);
        expect(envelopes[0]).toMatchObject({
            ownerAccount: "carol",
            spaceUuid: "space:abc",
            from: "alice",
            body: "hello",
            sendTimestamp: 100,
            clientMsgId: "c1",
            localId: "c1",
        });
        expect(envelopes[1]).toMatchObject({
            ownerAccount: "carol",
            from: "bob",
            body: "world",
            sendTimestamp: 200,
            clientMsgId: "c2",
            localId: "c2",
        });
    });
});

describe("resolveGroupMembersForHistorySync", () => {
    it("falls back to objective spaces before contacts-filtered conversations load", () => {
        const members = resolveGroupMembersForHistorySync(
            "space:abc",
            [],
            [
                {
                    space_uuid: "space:abc",
                    kind: "GROUP",
                    members: ["alice", "bob", "carol"],
                } as never,
            ],
        );
        expect(members).toEqual(["alice", "bob", "carol"]);
    });
});
