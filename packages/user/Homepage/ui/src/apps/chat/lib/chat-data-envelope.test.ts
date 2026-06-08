import { describe, expect, it } from "vitest";

import {
    parseChatDataWireEnvelope,
    serializeChatDataWireEnvelope,
} from "./chat-data-envelope";

describe("chat data channel wire envelopes", () => {
    it("round-trips chatMessage", () => {
        const envelope = {
            t: "chatMessage" as const,
            spaceUuid: "space:abc",
            from: "alice",
            body: "hello",
            sendTimestamp: 123,
            clientMsgId: "c1",
        };
        const raw = serializeChatDataWireEnvelope(envelope);
        expect(parseChatDataWireEnvelope(raw)).toEqual(envelope);
    });

    it("round-trips chatHistorySync for late-joiner mesh sync", () => {
        const envelope = {
            t: "chatHistorySync" as const,
            spaceUuid: "space:abc",
            messages: [
                {
                    from: "alice",
                    body: "offline msg",
                    sendTimestamp: 100,
                    clientMsgId: "a1",
                },
                {
                    from: "bob",
                    body: "reply",
                    sendTimestamp: 200,
                    clientMsgId: "b1",
                },
            ],
        };
        const raw = serializeChatDataWireEnvelope(envelope);
        expect(parseChatDataWireEnvelope(raw)).toEqual(envelope);
    });

    it("rejects invalid payloads", () => {
        expect(parseChatDataWireEnvelope('{"t":"say","body":"no"}')).toBeNull();
        expect(parseChatDataWireEnvelope("not json")).toBeNull();
    });

    /**
     * Plan F7: the receiver→sender delivery acknowledgement is the only
     * signal that flips a recipient from "pending" to "delivered". The
     * wire schema must round-trip identically so multi-version peers
     * during a rollout don't drop acks silently.
     */
    it("round-trips messageAck", () => {
        const envelope = {
            t: "messageAck" as const,
            spaceUuid: "space:abc",
            clientMsgId: "c1",
            from: "bob",
        };
        const raw = serializeChatDataWireEnvelope(envelope);
        expect(parseChatDataWireEnvelope(raw)).toEqual(envelope);
    });

    it("round-trips spaceMembershipHint", () => {
        const envelope = { t: "spaceMembershipHint" as const };
        const raw = serializeChatDataWireEnvelope(envelope);
        expect(parseChatDataWireEnvelope(raw)).toEqual(envelope);
    });

    it("rejects messageAck with missing required fields", () => {
        // No clientMsgId.
        expect(
            parseChatDataWireEnvelope(
                '{"t":"messageAck","spaceUuid":"s","from":"a"}',
            ),
        ).toBeNull();
        // No from.
        expect(
            parseChatDataWireEnvelope(
                '{"t":"messageAck","spaceUuid":"s","clientMsgId":"c"}',
            ),
        ).toBeNull();
    });
});
