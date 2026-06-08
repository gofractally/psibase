import { describe, expect, it } from "vitest";

import { buildGroupEnvelope } from "./group-message-history-store";
import {
    mergeTimelineMessagesWithGroupHistory,
    type GroupHistoryTimelineMessage,
} from "./group-message-history-ui";

function msg(input: {
    key: string;
    from: string;
    body: string;
    serverTime: number;
    status?: "sent" | "pending" | "failed";
    clientMsgId?: string;
    pendingRecipientCount?: number;
}): GroupHistoryTimelineMessage {
    return {
        kind: "message",
        key: input.key,
        clientMsgId: input.clientMsgId,
        from: input.from,
        body: input.body,
        serverTime: input.serverTime,
        status: input.status ?? "sent",
        pendingRecipientCount: input.pendingRecipientCount,
    } as GroupHistoryTimelineMessage & { pendingRecipientCount?: number };
}

describe("mergeTimelineMessagesWithGroupHistory", () => {
    it("retains a sender's pending group message when history restore has no envelope yet", () => {
        const merged = mergeTimelineMessagesWithGroupHistory(
            [
                msg({
                    key: "local-1",
                    clientMsgId: "client-1",
                    from: "alice",
                    body: "optimistic group body",
                    serverTime: 100,
                    status: "pending",
                    pendingRecipientCount: 1,
                }),
            ],
            [],
        );

        expect(merged).toHaveLength(1);
        expect(merged[0]).toMatchObject({
            clientMsgId: "client-1",
            body: "optimistic group body",
            status: "pending",
        });
    });

    it("preserves pending status when matching durable history arrives before all acks", () => {
        const merged = mergeTimelineMessagesWithGroupHistory(
            [
                msg({
                    key: "client-1",
                    clientMsgId: "client-1",
                    from: "alice",
                    body: "still pending for carol",
                    serverTime: 100,
                    status: "pending",
                    pendingRecipientCount: 1,
                }),
            ],
            [
                buildGroupEnvelope({
                    ownerAccount: "alice",
                    spaceUuid: "space:group",
                    from: "alice",
                    body: "still pending for carol",
                    sendTimestamp: 100,
                    clientMsgId: "client-1",
                }),
            ],
        );

        expect(merged).toHaveLength(1);
        expect(merged[0]).toMatchObject({
            clientMsgId: "client-1",
            status: "pending",
        });
    });
});
