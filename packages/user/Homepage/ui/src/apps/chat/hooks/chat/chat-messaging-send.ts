import type { MutableRefObject } from "react";

import { ensureDm, ensureGroup } from "../../lib/chat-api";
import { shortSpaceId } from "../../lib/chat-data-debug";
import { recordChurnTrace } from "../../lib/churn-trace";
import { composeTimingLog } from "../../lib/dm-compose-timing";
import { findVisibleDmWithPeer } from "../../lib/dm-contacts-meet-flow";
import {
    dmMembersForPendingPeer,
    shouldQueueFirstDmUntilSpace,
} from "../../lib/dm-first-message-send";
import { memberCanonicalKey } from "../../lib/group-contacts-meet-flow";
import type { PendingChatMessage } from "../../lib/pending-message-store";
import type { ConversationSnapshot } from "../../lib/protocol";
import {
    type GraphqlSpaceEntry,
    conversationIdFromSpaceUuid,
    deriveSpaceUuidForCanonicalMembers,
    spaceEntryToConversation,
} from "../../lib/space-bridge";
import { recordThreadLifecycle } from "../../lib/thread-lifecycle";
import { ChatTransportBridge } from "../../transport/chat-transport-bridge";
import type { PersistHistoryMessageInput } from "./use-chat-history";

/**
 * Outbound send / compose: chat-data session scheduling, DM/group open
 * flows, and the pending-enqueue + send pipeline. Deliberately excludes
 * inbound-message application and pending-message persistence — see
 * `chat-messaging-inbound.ts` and `chat-messaging-pending.ts`.
 */

export type ScheduleChatDataSessionDeps = {
    leavingChatRef: MutableRefObject<boolean>;
    transportBridgeRef: MutableRefObject<ChatTransportBridge | null>;
};

export function createScheduleDmChatDataSession(
    deps: ScheduleChatDataSessionDeps,
) {
    const { leavingChatRef, transportBridgeRef } = deps;
    return (spaceUuid: string, members: readonly string[]) => {
        if (leavingChatRef.current) {
            recordChurnTrace("ensure-skipped-leaving-chat", {
                kind: "dm",
                space: shortSpaceId(spaceUuid),
            });
            return;
        }
        composeTimingLog("scheduleDmChatDataSession", {
            space: shortSpaceId(spaceUuid),
        });
        transportBridgeRef.current?.ensureChatDataSession(spaceUuid, members);
    };
}

export function createScheduleGroupChatDataSession(
    deps: ScheduleChatDataSessionDeps,
) {
    const { leavingChatRef, transportBridgeRef } = deps;
    return (spaceUuid: string, members: readonly string[]) => {
        if (leavingChatRef.current) {
            recordChurnTrace("ensure-skipped-leaving-chat", {
                kind: "group",
                space: shortSpaceId(spaceUuid),
            });
            return;
        }
        composeTimingLog("scheduleGroupChatDataSession", {
            space: shortSpaceId(spaceUuid),
        });
        transportBridgeRef.current?.ensureChatDataSession(spaceUuid, members);
    };
}

export type SelectSpaceByMembersDeps = {
    conversationsRef: MutableRefObject<ConversationSnapshot[]>;
    setSelectedConversationId: (
        id: string | undefined,
        source?: string,
    ) => void;
};

export function createSelectSpaceByMembers(deps: SelectSpaceByMembersDeps) {
    const { conversationsRef, setSelectedConversationId } = deps;
    return (members: readonly string[]) => {
        const key = memberCanonicalKey(members);
        const match = conversationsRef.current.find(
            (row) => memberCanonicalKey(row.members) === key,
        );
        if (match) {
            setSelectedConversationId(match.conversationId);
        }
    };
}

export type OpenOrFocusDmDeps = {
    selfRef: MutableRefObject<string | null>;
    conversationsRef: MutableRefObject<ConversationSnapshot[]>;
    objectiveSpacesRef: MutableRefObject<GraphqlSpaceEntry[]>;
    contactAccountsRef: MutableRefObject<Set<string>>;
    contactsLoadedRef: MutableRefObject<boolean>;
    pendingDmMemberRef: MutableRefObject<string | null>;
    setComposePendingDmPeer: (value: string | null) => void;
    setSelectedConversationId: (
        id: string | undefined,
        source?: string,
    ) => void;
    setLastInboundError: (value: string | null) => void;
    loadObjectiveSpaces: () => Promise<GraphqlSpaceEntry[]>;
};

export function createOpenOrFocusDm(deps: OpenOrFocusDmDeps) {
    const {
        selfRef,
        conversationsRef,
        objectiveSpacesRef,
        contactAccountsRef,
        contactsLoadedRef,
        pendingDmMemberRef,
        setComposePendingDmPeer,
        setSelectedConversationId,
        setLastInboundError,
        loadObjectiveSpaces,
    } = deps;

    return (otherAccount: string) => {
        const self = selfRef.current;
        if (!self) return;

        if (otherAccount === self) {
            pendingDmMemberRef.current = null;
            setLastInboundError(
                "Direct messages are for another account. Choose a contact other than yourself.",
            );
            return;
        }

        const existing = conversationsRef.current.find(
            (row) =>
                row.kind === "dm" &&
                row.members.includes(otherAccount) &&
                row.members.includes(self),
        );

        if (existing) {
            pendingDmMemberRef.current = null;
            setComposePendingDmPeer(null);
            recordThreadLifecycle("compose-wake", {
                mode: "existing-dm",
                peer: otherAccount,
                spaceId: shortSpaceId(existing.conversationId),
            });
            setSelectedConversationId(
                existing.conversationId,
                "openOrFocusDm-existing",
            );
        } else {
            pendingDmMemberRef.current = otherAccount;
            setComposePendingDmPeer(otherAccount);
            recordThreadLifecycle("compose-wake", {
                mode: "pending-peer",
                peer: otherAccount,
            });
            composeTimingLog("openOrFocusDm-pending-peer", {
                peer: otherAccount,
            });
        }

        setLastInboundError(null);

        void (async () => {
            try {
                await ensureDm(otherAccount);
                await loadObjectiveSpaces();
            } catch (e) {
                const detail =
                    e instanceof Error ? e.message : "Could not create DM space.";
                setLastInboundError(detail);
                return;
            }

            const refreshed = findVisibleDmWithPeer(
                otherAccount,
                self,
                objectiveSpacesRef.current,
                contactAccountsRef.current,
                contactsLoadedRef.current,
            );

            if (refreshed) {
                if (pendingDmMemberRef.current !== otherAccount) {
                    return;
                }
                pendingDmMemberRef.current = null;
                setComposePendingDmPeer(null);
                setSelectedConversationId(
                    refreshed.conversationId,
                    "openOrFocusDm-created",
                );
            }
        })();
    };
}

export type OpenGroupChatDeps = {
    selfRef: MutableRefObject<string | null>;
    pendingGroupKeyRef: MutableRefObject<string | null>;
    transportBridgeRef: MutableRefObject<ChatTransportBridge | null>;
    setLastInboundError: (value: string | null) => void;
    loadObjectiveSpaces: () => Promise<GraphqlSpaceEntry[]>;
    selectSpaceByMembers: (members: readonly string[]) => void;
};

/**
 * Open a group chat: `otherAccounts` must be **other** accounts only (not the
 * current user). Server requires at least two distinct others (≥3 members
 * including self).
 */
export function createOpenGroupChat(deps: OpenGroupChatDeps) {
    const {
        selfRef,
        pendingGroupKeyRef,
        transportBridgeRef,
        setLastInboundError,
        loadObjectiveSpaces,
        selectSpaceByMembers,
    } = deps;

    return async (otherAccounts: readonly string[]) => {
        const self = selfRef.current;
        if (!self) return;

        const uniqueOthers = [...new Set(otherAccounts)].filter(
            (a) => a !== self,
        );
        if (uniqueOthers.length < 2) return;

        const key = memberCanonicalKey([self, ...uniqueOthers]);
        pendingGroupKeyRef.current = key;

        try {
            await ensureGroup(uniqueOthers);
            await loadObjectiveSpaces();
            transportBridgeRef.current?.notifySpaceMembershipHint(uniqueOthers);
        } catch (e) {
            pendingGroupKeyRef.current = null;
            const detail =
                e instanceof Error ? e.message : "Could not create group space.";
            setLastInboundError(detail);
            return;
        }

        selectSpaceByMembers([self, ...uniqueOthers]);
        setLastInboundError(null);
    };
}

export type EnqueueOutboundChatMessageDeps = {
    leavingChatRef: MutableRefObject<boolean>;
    transportBridgeRef: MutableRefObject<ChatTransportBridge | null>;
    pendingMessagesRef: MutableRefObject<Record<string, PendingChatMessage>>;
    setPendingMessages: (value: Record<string, PendingChatMessage>) => void;
    upsertPendingTimelineRow: (pending: PendingChatMessage) => void;
    persistPendingMessages: (
        next: Record<string, PendingChatMessage>,
    ) => boolean;
    drainQuotaPromotions: () => void;
    storageFailureRef: MutableRefObject<string | null>;
    scheduleDmChatDataSession: (
        spaceUuid: string,
        members: readonly string[],
    ) => void;
    scheduleGroupChatDataSession: (
        spaceUuid: string,
        members: readonly string[],
    ) => void;
    persistDmHistoryMessage: (
        input: PersistHistoryMessageInput,
    ) => Promise<void>;
    persistGroupHistoryMessage: (
        input: PersistHistoryMessageInput,
    ) => Promise<void>;
};

export function createEnqueueOutboundChatMessage(
    deps: EnqueueOutboundChatMessageDeps,
) {
    const {
        transportBridgeRef,
        pendingMessagesRef,
        setPendingMessages,
        upsertPendingTimelineRow,
        persistPendingMessages,
        drainQuotaPromotions,
        storageFailureRef,
        scheduleDmChatDataSession,
        scheduleGroupChatDataSession,
        persistDmHistoryMessage,
        persistGroupHistoryMessage,
    } = deps;

    return (
        convId: string,
        trimmed: string,
        from: string,
        recipients: string[],
        dmMembers: [string, string] | null,
        conversation: ConversationSnapshot | undefined,
    ) => {
        composeTimingLog("enqueue-outbound", {
            spaceId: shortSpaceId(convId),
            recipientCount: recipients.length,
            dmMembers: dmMembers !== null,
            conversationKind: conversation?.kind,
        });
        if (dmMembers && conversation?.kind === "group") {
            composeTimingLog("enqueue-outbound-routing-warn", {
                spaceId: shortSpaceId(convId),
                recipientCount: recipients.length,
                note: "DM members with group conversation snapshot",
            });
        }

        if (dmMembers) {
            scheduleDmChatDataSession(convId, dmMembers);
        } else if (
            conversation?.kind === "group" &&
            conversation.members.length > 2
        ) {
            scheduleGroupChatDataSession(convId, conversation.members);
        }

        const clientMsgId = crypto.randomUUID();
        const createdAt = Date.now();
        const pending: PendingChatMessage = {
            clientMsgId,
            conversationId: conversationIdFromSpaceUuid(convId),
            from,
            body: trimmed,
            createdAt,
            recipients,
            deliveredTo: [],
            status: "pending",
        };

        pendingMessagesRef.current = {
            ...pendingMessagesRef.current,
            [clientMsgId]: pending,
        };
        setPendingMessages(pendingMessagesRef.current);
        upsertPendingTimelineRow(pending);

        const messaging = transportBridgeRef.current?.messaging;
        if (messaging) {
            void (async () => {
                if (recipients.length === 1) {
                    await messaging.send({
                        spaceUuid: convId,
                        recipient: recipients[0]!,
                        body: trimmed,
                        clientMsgId,
                    });
                } else {
                    await messaging.sendGroup({
                        spaceUuid: convId,
                        recipient: recipients[0] ?? from,
                        recipients,
                        body: trimmed,
                        clientMsgId,
                    });
                }
            })();
        } else if (!persistPendingMessages(pendingMessagesRef.current)) {
            const failed = {
                ...pending,
                status: "failed" as const,
                errorReason:
                    storageFailureRef.current ??
                    "Pending message storage is unavailable.",
            };
            upsertPendingTimelineRow(failed);
            return;
        }

        drainQuotaPromotions();
        const spaceForHistory = convId;
        if (spaceForHistory && recipients.length === 1) {
            void persistDmHistoryMessage({
                spaceUuid: spaceForHistory,
                from,
                body: trimmed,
                sendTimestamp: createdAt,
                clientMsgId,
            });
        } else if (spaceForHistory && conversation?.kind === "group") {
            void persistGroupHistoryMessage({
                spaceUuid: spaceForHistory,
                from,
                body: trimmed,
                sendTimestamp: createdAt,
                clientMsgId,
            });
        }
    };
}

export type SendChatMessageDeps = {
    selfRef: MutableRefObject<string | null>;
    selectedConversationId: string | undefined;
    selectedConversationIdRef: MutableRefObject<string | undefined>;
    composePendingDmPeer: string | null;
    composePendingDmPeerRef: MutableRefObject<string | null>;
    pendingDmMemberRef: MutableRefObject<string | null>;
    conversationsRef: MutableRefObject<ConversationSnapshot[]>;
    objectiveSpacesRef: MutableRefObject<GraphqlSpaceEntry[]>;
    contactAccountsRef: MutableRefObject<Set<string>>;
    contactsLoadedRef: MutableRefObject<boolean>;
    resolveConversationSync: (
        spaceUuid: string,
    ) => ConversationSnapshot | undefined;
    setSelectedConversationId: (
        id: string | undefined,
        source?: string,
    ) => void;
    setComposePendingDmPeer: (value: string | null) => void;
    loadObjectiveSpaces: () => Promise<GraphqlSpaceEntry[]>;
    enqueueOutboundChatMessage: (
        convId: string,
        trimmed: string,
        from: string,
        recipients: string[],
        dmMembers: [string, string] | null,
        conversation: ConversationSnapshot | undefined,
    ) => void;
};

export function createSendChatMessage(deps: SendChatMessageDeps) {
    const {
        selfRef,
        selectedConversationId,
        selectedConversationIdRef,
        composePendingDmPeer,
        composePendingDmPeerRef,
        pendingDmMemberRef,
        conversationsRef,
        objectiveSpacesRef,
        contactAccountsRef,
        contactsLoadedRef,
        resolveConversationSync,
        setSelectedConversationId,
        setComposePendingDmPeer,
        loadObjectiveSpaces,
        enqueueOutboundChatMessage,
    } = deps;

    return (body: string) => {
        const convId =
            selectedConversationIdRef.current ?? selectedConversationId;
        const from = selfRef.current;
        const pendingPeer =
            composePendingDmPeerRef.current ??
            composePendingDmPeer ??
            pendingDmMemberRef.current;
        if ((!convId && !pendingPeer) || !from) return;

        const trimmed = body.trim();
        if (!trimmed) return;

        composeTimingLog("sendChatMessage", {
            convId: convId ? shortSpaceId(convId) : undefined,
            pendingPeer,
        });

        const resolveConversationForSend = (
            spaceUuid: string,
        ): ConversationSnapshot | undefined => {
            const listed = conversationsRef.current.find(
                (row) => row.conversationId === spaceUuid,
            );
            if (listed) return listed;
            const visible = resolveConversationSync(spaceUuid);
            if (visible) return visible;
            const entry = objectiveSpacesRef.current.find(
                (row) => row.space_uuid === spaceUuid,
            );
            return entry ? spaceEntryToConversation(entry) : undefined;
        };

        let conversation = convId ? resolveConversationForSend(convId) : undefined;

        let recipients: string[] = [];
        let dmMembers: [string, string] | null = null;

        if (conversation?.kind === "dm" && conversation.members.length === 2) {
            dmMembers = [conversation.members[0], conversation.members[1]];
            recipients = conversation.members.filter((member) => member !== from);
        } else if (pendingPeer) {
            dmMembers = dmMembersForPendingPeer(from, pendingPeer);
            if (dmMembers) {
                recipients = [pendingPeer];
            }
            if (!conversation) {
                conversation = findVisibleDmWithPeer(
                    pendingPeer,
                    from,
                    objectiveSpacesRef.current,
                    contactAccountsRef.current,
                    contactsLoadedRef.current,
                );
            }
        } else if (conversation) {
            recipients = conversation.members.filter((member) => member !== from);
        } else {
            composeTimingLog("sendChatMessage-abort", {
                reason: "no-conversation-or-recipients",
                convId: convId ? shortSpaceId(convId) : undefined,
                pendingPeer,
            });
            return;
        }

        const dmSendIntent = dmMembers !== null && recipients.length === 1;
        const selectedIsDm =
            conversation?.kind === "dm" && conversation.members.length === 2;

        composeTimingLog("sendChatMessage-routing", {
            convId: convId ? shortSpaceId(convId) : undefined,
            pendingPeer,
            dmSendIntent,
            selectedIsDm,
            conversationKind: conversation?.kind,
            recipientCount: recipients.length,
        });

        if (
            shouldQueueFirstDmUntilSpace(
                convId,
                pendingPeer,
                conversation?.kind,
            ) &&
            dmMembers
        ) {
            const bodyToSend = trimmed;
            const peerAccount = pendingPeer!;
            composeTimingLog("send-compose-first-dm", {
                pendingPeer: peerAccount,
            });
            void (async () => {
                try {
                    await ensureDm(peerAccount);
                    await loadObjectiveSpaces();
                } catch {
                    /* banner already set from openOrFocusDm */
                }
                const chainSpace = findVisibleDmWithPeer(
                    peerAccount,
                    from,
                    objectiveSpacesRef.current,
                    contactAccountsRef.current,
                    contactsLoadedRef.current,
                );
                const outboundSpace =
                    chainSpace?.conversationId ??
                    (await deriveSpaceUuidForCanonicalMembers(dmMembers));
                pendingDmMemberRef.current = null;
                setComposePendingDmPeer(null);
                setSelectedConversationId(
                    outboundSpace,
                    "send-compose-first-dm",
                );
                enqueueOutboundChatMessage(
                    outboundSpace,
                    bodyToSend,
                    from,
                    [peerAccount],
                    dmMembers,
                    chainSpace ??
                        conversation ??
                        spaceEntryToConversation({
                            space_uuid: outboundSpace,
                            members: [...dmMembers],
                            kind: "DM",
                        }),
                );
            })();
            return;
        }

        const needsDerivedDmSpace = dmSendIntent && (!selectedIsDm || !convId);

        if (needsDerivedDmSpace && dmMembers) {
            const bodyToSend = trimmed;
            const sendRecipients = recipients;
            const sendDmMembers = dmMembers;
            const sendConversation = conversation;
            composeTimingLog("send-derived-dm-space", {
                pendingPeer,
                recipientCount: sendRecipients.length,
                reason: selectedIsDm ? "missing-conv-id" : "selected-non-dm",
                selectedKind: conversation?.kind,
                selectedConvId: convId ? shortSpaceId(convId) : undefined,
            });
            void (async () => {
                if (pendingPeer) {
                    try {
                        await ensureDm(pendingPeer);
                        await loadObjectiveSpaces();
                    } catch {
                        /* banner already set */
                    }
                }
                const chainSpace = pendingPeer
                    ? findVisibleDmWithPeer(
                          pendingPeer,
                          from,
                          objectiveSpacesRef.current,
                          contactAccountsRef.current,
                          contactsLoadedRef.current,
                      )
                    : undefined;
                const outboundSpace =
                    chainSpace?.conversationId ??
                    (await deriveSpaceUuidForCanonicalMembers(sendDmMembers));
                if (!selectedConversationIdRef.current) {
                    setSelectedConversationId(
                        outboundSpace,
                        "send-derived-dm-space",
                    );
                }
                enqueueOutboundChatMessage(
                    outboundSpace,
                    bodyToSend,
                    from,
                    sendRecipients,
                    sendDmMembers,
                    chainSpace ??
                        sendConversation ??
                        spaceEntryToConversation({
                            space_uuid: outboundSpace,
                            members: [...sendDmMembers],
                            kind: "DM",
                        }),
                );
            })();
            return;
        }

        const outboundSpaceId = convId ?? conversation?.conversationId ?? undefined;

        if (!outboundSpaceId || recipients.length === 0) {
            composeTimingLog("sendChatMessage-abort", {
                reason: "missing-space-or-recipients",
                outboundSpaceId: outboundSpaceId
                    ? shortSpaceId(outboundSpaceId)
                    : undefined,
                recipientCount: recipients.length,
            });
            return;
        }

        enqueueOutboundChatMessage(
            outboundSpaceId,
            trimmed,
            from,
            recipients,
            dmMembers,
            conversation,
        );
    };
}
