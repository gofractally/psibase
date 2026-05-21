import { describe, expect, it } from "vitest";

import type { AvCallSessionSnapshot } from "./av-call-session-types";
import {
    isAvCallTransportActive,
    shouldReleaseIdleChatDataTransport,
    shouldThrottleBackgroundDmEnsure,
} from "./chat-data-idle-release";
import { dmComposerDisabledReason } from "./dm-compose-ux";
import { seedDeliveryOpenPeersFromHistory } from "./delivery-open-peers";
import { shouldPushGroupHistoryOnConnect } from "./group-history-sync";
import { planPendingFlush } from "./pending-message-flush";

const SPACE = "space-dm-1";
const SELF = "alice";
const BOB = "bob";

function avSnap(
    phase: AvCallSessionSnapshot["phase"],
): AvCallSessionSnapshot {
    return {
        spaceUuid: SPACE,
        phase,
        signalingJoined: phase === "ready",
    };
}

describe("M3/M4 chat regression on Meet stack (T-047)", () => {
    describe("chat-data idle release vs av-call", () => {
        it("releases when pending drained, space deselected, no Meet", () => {
            expect(
                shouldReleaseIdleChatDataTransport({
                    spaceId: SPACE,
                    selectedConversationId: "space-other",
                    stillPendingForSpace: false,
                }),
            ).toBe(true);
        });

        it("retains transport while av-call UI is active on the Space", () => {
            expect(
                shouldReleaseIdleChatDataTransport({
                    spaceId: SPACE,
                    selectedConversationId: "space-other",
                    stillPendingForSpace: false,
                    activeAvCallConversationId: SPACE,
                    activeAvCallSource: "av-call",
                }),
            ).toBe(false);
        });

        it("retains transport while av-call orchestrator is not idle", () => {
            expect(isAvCallTransportActive(avSnap("signaling"))).toBe(true);
            expect(
                shouldReleaseIdleChatDataTransport({
                    spaceId: SPACE,
                    selectedConversationId: "space-other",
                    stillPendingForSpace: false,
                    avCallSnapshot: avSnap("ready"),
                }),
            ).toBe(false);
        });

        it("allows release after av-call ends (idle/failed)", () => {
            expect(isAvCallTransportActive(avSnap("idle"))).toBe(false);
            expect(isAvCallTransportActive(avSnap("failed"))).toBe(false);
            expect(
                shouldReleaseIdleChatDataTransport({
                    spaceId: SPACE,
                    selectedConversationId: "space-other",
                    stillPendingForSpace: false,
                    avCallSnapshot: avSnap("idle"),
                }),
            ).toBe(true);
        });

        it("throttles background DM ensure while a group is focused", () => {
            const conversations = [
                { conversationId: "space-group", kind: "group" as const },
                { conversationId: SPACE, kind: "dm" as const },
            ];
            expect(
                shouldThrottleBackgroundDmEnsure({
                    selectedConversationId: "space-group",
                    ensureSpaceUuid: SPACE,
                    conversations,
                    lastEnsureMs: Date.now() - 500,
                }),
            ).toBe(true);
            expect(
                shouldThrottleBackgroundDmEnsure({
                    selectedConversationId: SPACE,
                    ensureSpaceUuid: SPACE,
                    conversations,
                    lastEnsureMs: 0,
                }),
            ).toBe(false);
        });
    });

    describe("M3 deliveryOpenPeers seeding", () => {
        it("seeds peers from durable DM history with pending exclusion", () => {
            const seeded = seedDeliveryOpenPeersFromHistory(
                "chain-1",
                SELF,
                [
                    {
                        ownerAccount: SELF,
                        peerAccount: BOB,
                        spaceUuid: SPACE,
                        from: BOB,
                        body: "hi",
                        sendTimestamp: 1,
                        localId: "1",
                    },
                ],
                { pendingClientMsgIds: new Set(["pending-1"]) },
            );
            expect(seeded).toBe(1);
        });
    });

    describe("M4 group history sync predicate", () => {
        it("pushes history for late-joiner and returning-member peers", () => {
            expect(shouldPushGroupHistoryOnConnect(false)).toBe(true);
            expect(shouldPushGroupHistoryOnConnect(true)).toBe(false);
            expect(
                shouldPushGroupHistoryOnConnect(true, {
                    hadOpenDataChannel: true,
                }),
            ).toBe(true);
        });
    });

    describe("M3/M4 compose-first with Meet", () => {
        it("keeps DM composer enabled while session setup runs", () => {
            expect(
                dmComposerDisabledReason({
                    spacesLoadError: null,
                    authLost: false,
                    selfAccount: SELF,
                    selectedConversationId: SPACE,
                    pendingDmPeerAccount: null,
                }),
            ).toBeNull();
        });
    });

    describe("M4 per-peer pending flush", () => {
        it("plans group send when mesh peer is ready", () => {
            const plan = planPendingFlush({
                self: SELF,
                chainId: "chain-1",
                pendingMessages: [
                    {
                        clientMsgId: "m1",
                        conversationId: SPACE,
                        from: SELF,
                        body: "hello",
                        createdAt: 100,
                        recipients: [BOB],
                        deliveredTo: [],
                        status: "pending",
                    },
                ],
                conversations: [
                    {
                        conversationId: SPACE,
                        kind: "group",
                        members: [SELF, BOB, "carol"],
                    },
                ],
                presenceByAccount: { [BOB]: "online" },
                realtimeReady: true,
                inFlightKeys: new Set(),
                getDmSnapshot: () => undefined,
                getGroupMeshPeerReady: () => true,
                isDeliveryOpenPeer: () => true,
                canonicalDmMembers: () => null,
            });
            expect(plan.actions.some((a) => a.kind === "sendGroup")).toBe(true);
        });
    });
});
