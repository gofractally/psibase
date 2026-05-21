import { describe, expect, it } from "vitest";

import type { ChatDataSessionSnapshot } from "./chat-data-session-orchestrator";
import {
    planPendingFlush,
    type FlushConversation,
    type FlushPendingMessage,
    type FlushPlanInputs,
} from "./pending-message-flush";

const SELF = "alice";
const PEER = "bob";
const CHAIN = "chain:test";
const SPACE = "space:abc";
const CONV = "c:abc";

const READY: ChatDataSessionSnapshot = {
    spaceUuid: SPACE,
    phase: "ready",
    sessionId: "s1",
    dataChannelReady: true,
};
const NOT_READY: ChatDataSessionSnapshot = {
    spaceUuid: SPACE,
    phase: "signaling",
    sessionId: "s1",
    dataChannelReady: false,
};

function pendingDm(overrides: Partial<FlushPendingMessage> = {}): FlushPendingMessage {
    return {
        clientMsgId: "m1",
        conversationId: CONV,
        from: SELF,
        body: "hello",
        createdAt: 1,
        recipients: [PEER],
        deliveredTo: [],
        status: "pending",
        ...overrides,
    };
}

function dmConv(): FlushConversation {
    return { conversationId: SPACE, kind: "dm", members: [SELF, PEER] };
}

function groupConv(members: string[]): FlushConversation {
    return { conversationId: SPACE, kind: "group", members };
}

function makeInputs(over: Partial<FlushPlanInputs>): FlushPlanInputs {
    return {
        self: SELF,
        chainId: CHAIN,
        pendingMessages: [],
        conversations: [],
        presenceByAccount: {},
        realtimeReady: true,
        inFlightKeys: new Set(),
        getDmSnapshot: () => READY,
        getGroupMeshPeerReady: () => true,
        isDeliveryOpenPeer: () => true,
        canonicalDmMembers: (self, recipients) =>
            recipients.length === 1 ? [self, recipients[0]!].sort() : null,
        ...over,
    };
}

describe("planPendingFlush — DM", () => {
    it("emits ensureDm and sendDm when data channel is ready", () => {
        const plan = planPendingFlush(
            makeInputs({
                pendingMessages: [pendingDm()],
                conversations: [dmConv()],
                presenceByAccount: { [PEER]: "online" },
            }),
        );
        const ensure = plan.actions.find((a) => a.kind === "ensureDm");
        const send = plan.actions.find((a) => a.kind === "sendDm");
        expect(ensure).toMatchObject({
            kind: "ensureDm",
            spaceUuid: SPACE,
        });
        expect(send).toMatchObject({
            kind: "sendDm",
            spaceUuid: SPACE,
            recipient: PEER,
            flightKey: "m1:bob",
        });
        if (send && send.kind === "sendDm") {
            expect(send.envelope).toMatchObject({
                t: "chatMessage",
                spaceUuid: SPACE,
                from: SELF,
                body: "hello",
                clientMsgId: "m1",
            });
        }
    });

    it("calls ensureDm but skips when data channel is not ready (this is the rejoin gap)", () => {
        const plan = planPendingFlush(
            makeInputs({
                pendingMessages: [pendingDm()],
                conversations: [dmConv()],
                getDmSnapshot: () => NOT_READY,
            }),
        );
        expect(plan.actions.find((a) => a.kind === "ensureDm")).toBeDefined();
        expect(plan.actions.find((a) => a.kind === "sendDm")).toBeUndefined();
        const skip = plan.actions.find((a) => a.kind === "skip");
        expect(skip).toMatchObject({
            kind: "skip",
            reason: "data-channel-not-ready",
            phase: "signaling",
        });
    });

    it("does not re-send to recipients already delivered", () => {
        const plan = planPendingFlush(
            makeInputs({
                pendingMessages: [pendingDm({ deliveredTo: [PEER] })],
                conversations: [dmConv()],
            }),
        );
        expect(plan.actions.find((a) => a.kind === "sendDm")).toBeUndefined();
        expect(
            plan.actions.find(
                (a) => a.kind === "skip" && a.reason === "delivered",
            ),
        ).toBeDefined();
    });

    it("does not duplicate sends for in-flight flight keys", () => {
        const plan = planPendingFlush(
            makeInputs({
                pendingMessages: [pendingDm()],
                conversations: [dmConv()],
                inFlightKeys: new Set(["m1:bob"]),
            }),
        );
        expect(plan.actions.find((a) => a.kind === "sendDm")).toBeUndefined();
        expect(
            plan.actions.find(
                (a) => a.kind === "skip" && a.reason === "in-flight",
            ),
        ).toBeDefined();
    });

    it("falls back to canonicalDmMembers when conversation snapshot is missing", () => {
        const plan = planPendingFlush(
            makeInputs({
                pendingMessages: [pendingDm()],
                conversations: [],
            }),
        );
        const ensure = plan.actions.find((a) => a.kind === "ensureDm");
        expect(ensure).toMatchObject({
            kind: "ensureDm",
            members: [SELF, PEER].sort(),
        });
    });
});

describe("planPendingFlush — group", () => {
    const SELF_G = "alice";
    const others = ["bob", "carol"];

    function pendingGroup(): FlushPendingMessage {
        return {
            clientMsgId: "g1",
            conversationId: CONV,
            from: SELF_G,
            body: "hi group",
            createdAt: 1,
            recipients: others,
            deliveredTo: [],
            status: "pending",
        };
    }

    it("emits sendGroup actions only for online + mesh-ready peers", () => {
        const plan = planPendingFlush(
            makeInputs({
                self: SELF_G,
                pendingMessages: [pendingGroup()],
                conversations: [groupConv([SELF_G, ...others])],
                presenceByAccount: { bob: "online", carol: "offline" },
                getGroupMeshPeerReady: (_space, r) => r === "bob",
            }),
        );
        const sends = plan.actions.filter((a) => a.kind === "sendGroup");
        expect(sends).toHaveLength(1);
        expect(sends[0]).toMatchObject({ recipient: "bob" });
        const offlineSkip = plan.actions.find(
            (a) =>
                a.kind === "skip" &&
                a.recipient === "carol" &&
                a.reason === "recipient-offline",
        );
        expect(offlineSkip).toBeDefined();
    });

    it("skips peers whose mesh peer is not yet ready", () => {
        const plan = planPendingFlush(
            makeInputs({
                self: SELF_G,
                pendingMessages: [pendingGroup()],
                conversations: [groupConv([SELF_G, ...others])],
                presenceByAccount: { bob: "online", carol: "online" },
                getGroupMeshPeerReady: () => false,
            }),
        );
        expect(plan.actions.find((a) => a.kind === "sendGroup")).toBeUndefined();
        expect(
            plan.actions.filter(
                (a) =>
                    a.kind === "skip" &&
                    a.reason === "group-mesh-peer-not-ready",
            ),
        ).toHaveLength(2);
    });
});

describe("planPendingFlush — pslack fallback", () => {
    it("only sends via pslack when state is synced and recipient is delivery-open", () => {
        const plan = planPendingFlush(
            makeInputs({
                pendingMessages: [
                    pendingDm({
                        recipients: [PEER, "carol"],
                    }),
                ],
                conversations: [groupConv([SELF, PEER, "carol"])],
                presenceByAccount: { [PEER]: "online", carol: "online" },
                getGroupMeshPeerReady: () => false,
                realtimeReady: true,
                isDeliveryOpenPeer: (_chain, _self, peer) => peer === PEER,
            }),
        );
        expect(plan.actions.find((a) => a.kind === "sendGroup")).toBeUndefined();
    });

    it("skips with realtime-not-ready when conversation is missing and transport not ready", () => {
        const plan = planPendingFlush(
            makeInputs({
                pendingMessages: [
                    pendingDm({
                        recipients: [PEER, "carol"],
                        conversationId: "c:nonspace",
                    }),
                ],
                conversations: [],
                realtimeReady: false,
            }),
        );
        expect(
            plan.actions.find(
                (a) => a.kind === "skip" && a.reason === "realtime-not-ready",
            ),
        ).toBeDefined();
    });

    it("skips unknown conversations when realtime is ready (no websocket fallback)", () => {
        const plan = planPendingFlush(
            makeInputs({
                pendingMessages: [
                    pendingDm({
                        recipients: ["carol", "dave"],
                        conversationId: "c:legacy-group",
                    }),
                ],
                conversations: [],
                presenceByAccount: { carol: "online", dave: "online" },
                isDeliveryOpenPeer: () => false,
                forceRecipients: new Set(["carol"]),
            }),
        );
        expect(
            plan.actions.find(
                (a) =>
                    a.kind === "skip" && a.reason === "data-channel-not-ready",
            ),
        ).toBeDefined();
    });
});

/** Plan C3: targeted flush, delivery-open gating, and dead-input wiring. */
describe("planPendingFlush — C3 forceRecipients + isDeliveryOpenPeer", () => {
    it("DM: forceRecipients restricts sends to the targeted recipient", () => {
        const plan = planPendingFlush(
            makeInputs({
                pendingMessages: [
                    pendingDm({
                        clientMsgId: "to-bob",
                        recipients: ["bob"],
                    }),
                    pendingDm({
                        clientMsgId: "to-carol",
                        conversationId: "c:carol",
                        recipients: ["carol"],
                    }),
                ],
                conversations: [
                    { conversationId: SPACE, kind: "dm", members: [SELF, PEER] },
                    {
                        conversationId: "space:carol",
                        kind: "dm",
                        members: [SELF, "carol"],
                    },
                ],
                isDeliveryOpenPeer: () => true,
                forceRecipients: new Set(["bob"]),
            }),
        );
        const sends = plan.actions.filter((a) => a.kind === "sendDm");
        expect(sends.map((a) => "recipient" in a && a.recipient)).toEqual([
            "bob",
        ]);
        expect(
            plan.actions.find(
                (a) =>
                    a.kind === "skip" &&
                    a.recipient === "carol" &&
                    a.reason === "delivery-not-open",
            ),
        ).toBeDefined();
    });

    it("DM: forceRecipients suppresses ensureDm for non-targeted conversations", () => {
        const plan = planPendingFlush(
            makeInputs({
                pendingMessages: [
                    pendingDm({
                        clientMsgId: "to-carol",
                        conversationId: "c:carol",
                        recipients: ["carol"],
                    }),
                ],
                conversations: [
                    {
                        conversationId: "space:carol",
                        kind: "dm",
                        members: [SELF, "carol"],
                    },
                ],
                isDeliveryOpenPeer: () => true,
                forceRecipients: new Set(["bob"]),
            }),
        );
        expect(
            plan.actions.find((a) => a.kind === "ensureDm"),
        ).toBeUndefined();
    });

    it("DM: periodic flush skips never-delivered peers that are not delivery-open when transport is down", () => {
        const plan = planPendingFlush(
            makeInputs({
                pendingMessages: [
                    pendingDm({
                        clientMsgId: "stale",
                        recipients: [PEER],
                    }),
                ],
                conversations: [dmConv()],
                getDmSnapshot: () => NOT_READY,
                isDeliveryOpenPeer: () => false,
            }),
        );
        expect(
            plan.actions.find((a) => a.kind === "ensureDm"),
        ).toBeUndefined();
        expect(plan.actions.find((a) => a.kind === "sendDm")).toBeUndefined();
        expect(
            plan.actions.find(
                (a) =>
                    a.kind === "skip" &&
                    a.reason === "data-channel-not-ready",
            ),
        ).toBeDefined();
    });

    it("DM: sends first message when DC ready even if peer is not delivery-open", () => {
        const plan = planPendingFlush(
            makeInputs({
                pendingMessages: [
                    pendingDm({
                        clientMsgId: "first-dm",
                        recipients: [PEER],
                    }),
                ],
                conversations: [dmConv()],
                isDeliveryOpenPeer: () => false,
            }),
        );
        expect(plan.actions.find((a) => a.kind === "sendDm")).toMatchObject({
            kind: "sendDm",
            recipient: PEER,
        });
    });

    it("DM: periodic flush still sends for active conversations (already delivered to peer once)", () => {
        const plan = planPendingFlush(
            makeInputs({
                pendingMessages: [
                    pendingDm({
                        clientMsgId: "follow-up",
                        recipients: [PEER, "carol"],
                        deliveredTo: [PEER],
                    }),
                ],
                conversations: [
                    {
                        conversationId: SPACE,
                        kind: "dm",
                        members: [SELF, PEER, "carol"],
                    },
                ],
                isDeliveryOpenPeer: () => false,
            }),
        );
        const ensure = plan.actions.find((a) => a.kind === "ensureDm");
        expect(ensure).toBeDefined();
        const sends = plan.actions.filter((a) => a.kind === "sendDm");
        expect(sends.map((a) => "recipient" in a && a.recipient)).toEqual([
            "carol",
        ]);
    });

    it("group: forceRecipients restricts mesh sends to the targeted recipient", () => {
        const plan = planPendingFlush(
            makeInputs({
                pendingMessages: [
                    {
                        clientMsgId: "g",
                        conversationId: CONV,
                        from: SELF,
                        body: "hi",
                        createdAt: 1,
                        recipients: ["bob", "carol"],
                        deliveredTo: [],
                        status: "pending",
                    },
                ],
                conversations: [groupConv([SELF, "bob", "carol"])],
                presenceByAccount: { bob: "online", carol: "online" },
                getGroupMeshPeerReady: () => true,
                forceRecipients: new Set(["bob"]),
            }),
        );
        const sends = plan.actions.filter((a) => a.kind === "sendGroup");
        expect(sends.map((a) => "recipient" in a && a.recipient)).toEqual([
            "bob",
        ]);
    });

    it("group: returning member mesh ready flushes pending to reconnected peer", () => {
        const plan = planPendingFlush(
            makeInputs({
                self: "bob",
                pendingMessages: [
                    {
                        clientMsgId: "away-1",
                        conversationId: CONV,
                        from: "bob",
                        body: "while-alice-was-away",
                        createdAt: 1,
                        recipients: ["alice", "carol"],
                        deliveredTo: ["carol"],
                        status: "pending",
                    },
                ],
                conversations: [groupConv(["alice", "bob", "carol"])],
                presenceByAccount: { alice: "online", carol: "online" },
                getGroupMeshPeerReady: (space, recipient) =>
                    recipient === "alice",
                forceRecipients: new Set(["alice"]),
            }),
        );
        const sends = plan.actions.filter((a) => a.kind === "sendGroup");
        expect(sends.map((a) => "recipient" in a && a.recipient)).toEqual([
            "alice",
        ]);
    });

    it("periodic flush with no chainId attempts every recipient (delivery-open gate disabled)", () => {
        const plan = planPendingFlush(
            makeInputs({
                pendingMessages: [pendingDm()],
                conversations: [dmConv()],
                chainId: null,
                isDeliveryOpenPeer: () => false,
            }),
        );
        expect(plan.actions.find((a) => a.kind === "sendDm")).toBeDefined();
    });
});
