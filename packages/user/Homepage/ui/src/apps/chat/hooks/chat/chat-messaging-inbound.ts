import type { Dispatch, MutableRefObject, SetStateAction } from "react";

import type {
    ChatDataMessageEnvelope,
    ChatHistorySyncEnvelope,
} from "../../lib/chat-data-envelope";
import type {
    ChatTimelineMessageRow,
    ChatTimelineRow,
} from "../../lib/chat-timeline-types";
import { sortTimelineRows } from "../../lib/chat-timeline-types";
import { isInboundContactPeer } from "../../lib/contacts-policy";
import { markDeliveryOpenPeer } from "../../lib/delivery-open-peers";
import {
    envelopesToHistorySyncMessages,
    historySyncToDmEnvelopes,
} from "../../lib/dm-history-sync";
import {
    dmPeerAccount,
    getDmMessageHistoryStore,
} from "../../lib/dm-message-history-store";
import { mergeTimelineMessagesBySendTimestamp } from "../../lib/dm-message-history-ui";
import {
    historySyncToGroupEnvelopes,
    resolveGroupMembersForHistorySync,
} from "../../lib/group-history-sync";
import {
    buildGroupEnvelope,
    getGroupMessageHistoryStore,
} from "../../lib/group-message-history-store";
import { mergeTimelineMessagesWithGroupHistory } from "../../lib/group-message-history-ui";
import {
    dequeueHistorySyncPush,
    enqueueHistorySyncPush,
    historySyncPushForPeer,
} from "../../lib/history-sync-push-queue";
import type { InboundMessageAcceptance } from "../../lib/inbound-message-acceptance";
import { inboundMessageAcceptance } from "../../lib/inbound-message-acceptance";
import { listInboundAckTargets } from "../../lib/inbound-message-ack";
import type { ConversationSnapshot } from "../../lib/protocol";
import {
    type GraphqlSpaceEntry,
    conversationIdFromSpaceUuid,
    spaceUuidFromConversationId,
} from "../../lib/space-bridge";
import { ChatTransportBridge } from "../../transport/chat-transport-bridge";
import type { PersistHistoryMessageInput } from "./use-chat-history";

/**
 * Inbound message application (data-channel messages + history sync) and
 * the history-sync push/drain queue. Deliberately excludes pending-message
 * persistence and outbound send/compose — see `chat-messaging-pending.ts`
 * and `chat-messaging-send.ts`.
 */

export type ApplyInboundChatMessageDeps = {
    selfRef: MutableRefObject<string | null>;
    selectedConversationIdRef: MutableRefObject<string | undefined>;
    composePendingDmPeerRef: MutableRefObject<string | null>;
    pendingDmMemberRef: MutableRefObject<string | null>;
    setComposePendingDmPeer: (value: string | null) => void;
    setSelectedConversationId: (
        id: string | undefined,
        source?: string,
    ) => void;
    setUnreadByConversation: Dispatch<SetStateAction<Record<string, number>>>;
    setTimelineByConversation: Dispatch<
        SetStateAction<Record<string, ChatTimelineRow[]>>
    >;
    persistDmHistoryMessage: (
        input: PersistHistoryMessageInput,
    ) => Promise<void>;
};

export function createApplyInboundChatMessage(deps: ApplyInboundChatMessageDeps) {
    const {
        selfRef,
        selectedConversationIdRef,
        composePendingDmPeerRef,
        pendingDmMemberRef,
        setComposePendingDmPeer,
        setSelectedConversationId,
        setUnreadByConversation,
        setTimelineByConversation,
        persistDmHistoryMessage,
    } = deps;

    return (frame: {
        conversationId: string;
        from: string;
        body: string;
        serverMsgId?: number;
        serverTime: number;
        clientMsgId?: string;
        clientTime?: number;
    }) => {
        const self = selfRef.current;
        if (!self || frame.from === self) return;

        const spaceId = spaceUuidFromConversationId(frame.conversationId);
        const selectedId = selectedConversationIdRef.current;
        const pendingPeer = composePendingDmPeerRef.current;
        if (pendingPeer === frame.from) {
            pendingDmMemberRef.current = null;
            setComposePendingDmPeer(null);
            if (selectedId !== spaceId) {
                setSelectedConversationId(spaceId, "inbound-dm-pending-peer");
            }
        } else if (spaceId !== selectedId) {
            setUnreadByConversation((prev) => ({
                ...prev,
                [spaceId]: (prev[spaceId] ?? 0) + 1,
            }));
        }

        setTimelineByConversation((prev) => {
            const prevList = [...(prev[spaceId] ?? [])];
            const { clientMsgId, clientTime, serverMsgId, serverTime, from, body } =
                frame;

            if (clientMsgId) {
                const ix = prevList.findIndex(
                    (m) => m.kind === "message" && m.clientMsgId === clientMsgId,
                );
                if (ix >= 0) {
                    const cur = prevList[ix] as ChatTimelineMessageRow;
                    prevList[ix] = {
                        ...cur,
                        kind: "message",
                        key: clientMsgId,
                        clientMsgId,
                        serverMsgId,
                        serverTime: clientTime ?? serverTime,
                        from,
                        body,
                        status: "sent",
                    };
                    return { ...prev, [spaceId]: prevList };
                }
            }

            if (
                typeof serverMsgId === "number" &&
                prevList.some(
                    (m) => m.kind === "message" && m.serverMsgId === serverMsgId,
                )
            ) {
                return prev;
            }

            prevList.push({
                kind: "message",
                key:
                    clientMsgId ??
                    (typeof serverMsgId === "number"
                        ? `srv-${serverMsgId}`
                        : crypto.randomUUID()),
                serverMsgId,
                clientMsgId,
                from,
                body,
                serverTime: clientTime ?? serverTime,
                status: "sent",
            });
            sortTimelineRows(prevList);
            return { ...prev, [spaceId]: prevList };
        });

        void persistDmHistoryMessage({
            spaceUuid: spaceId,
            from: frame.from,
            body: frame.body,
            sendTimestamp: frame.clientTime ?? frame.serverTime,
            clientMsgId: frame.clientMsgId,
            serverMsgId: frame.serverMsgId,
        });
    };
}

export type ApplyInboundDmDataChannelMessageDeps = {
    selfRef: MutableRefObject<string | null>;
    contactAccountsRef: MutableRefObject<Set<string>>;
    contactsLoadedRef: MutableRefObject<boolean>;
    chainIdRef: MutableRefObject<string>;
    applyInboundChatMessageRef: MutableRefObject<
        (frame: {
            conversationId: string;
            from: string;
            body: string;
            serverMsgId?: number;
            serverTime: number;
            clientMsgId?: string;
            clientTime?: number;
        }) => void
    >;
};

export function createApplyInboundDmDataChannelMessage(
    deps: ApplyInboundDmDataChannelMessageDeps,
) {
    const {
        selfRef,
        contactAccountsRef,
        contactsLoadedRef,
        chainIdRef,
        applyInboundChatMessageRef,
    } = deps;

    return (envelope: ChatDataMessageEnvelope): InboundMessageAcceptance => {
        const self = selfRef.current;
        if (!self || envelope.from === self) return "rejected";

        const acceptance = inboundMessageAcceptance(
            self,
            envelope.from,
            contactAccountsRef.current,
            contactsLoadedRef.current,
        );
        if (acceptance !== "accepted") return acceptance;

        const chain = chainIdRef.current;
        if (chain) {
            markDeliveryOpenPeer(chain, self, envelope.from);
        }
        applyInboundChatMessageRef.current({
            conversationId: conversationIdFromSpaceUuid(envelope.spaceUuid),
            from: envelope.from,
            body: envelope.body,
            serverTime: envelope.sendTimestamp,
            clientMsgId: envelope.clientMsgId,
            clientTime: envelope.sendTimestamp,
        });
        return "accepted";
    };
}

export type ApplyInboundGroupDataChannelMessageDeps = {
    selfRef: MutableRefObject<string | null>;
    contactAccountsRef: MutableRefObject<Set<string>>;
    contactsLoadedRef: MutableRefObject<boolean>;
    chainIdRef: MutableRefObject<string>;
    selectedConversationIdRef: MutableRefObject<string | undefined>;
    setUnreadByConversation: Dispatch<SetStateAction<Record<string, number>>>;
    setTimelineByConversation: Dispatch<
        SetStateAction<Record<string, ChatTimelineRow[]>>
    >;
    persistGroupHistoryMessage: (
        input: PersistHistoryMessageInput,
    ) => Promise<void>;
    flushPendingMessagesRef: MutableRefObject<() => void>;
};

export function createApplyInboundGroupDataChannelMessage(
    deps: ApplyInboundGroupDataChannelMessageDeps,
) {
    const {
        selfRef,
        contactAccountsRef,
        contactsLoadedRef,
        chainIdRef,
        selectedConversationIdRef,
        setUnreadByConversation,
        setTimelineByConversation,
        persistGroupHistoryMessage,
        flushPendingMessagesRef,
    } = deps;

    return (envelope: ChatDataMessageEnvelope): InboundMessageAcceptance => {
        const self = selfRef.current;
        if (!self || envelope.from === self) return "rejected";

        const acceptance = inboundMessageAcceptance(
            self,
            envelope.from,
            contactAccountsRef.current,
            contactsLoadedRef.current,
        );
        if (acceptance !== "accepted") return acceptance;

        const chain = chainIdRef.current;
        if (chain) {
            markDeliveryOpenPeer(chain, self, envelope.from);
        }

        const spaceId = envelope.spaceUuid;
        const selectedId = selectedConversationIdRef.current;
        if (spaceId !== selectedId) {
            setUnreadByConversation((prev) => ({
                ...prev,
                [spaceId]: (prev[spaceId] ?? 0) + 1,
            }));
        }

        setTimelineByConversation((prev) => {
            const existing = prev[spaceId] ?? [];
            const callEvents = existing.filter((row) => row.kind === "callEvent");
            const existingMessages = existing.filter(
                (row): row is ChatTimelineMessageRow => row.kind === "message",
            );
            const inboundEnvelope = buildGroupEnvelope({
                ownerAccount: self,
                spaceUuid: spaceId,
                from: envelope.from,
                body: envelope.body,
                sendTimestamp: envelope.sendTimestamp,
                clientMsgId: envelope.clientMsgId,
            });
            const mergedMessages = mergeTimelineMessagesWithGroupHistory(
                existingMessages,
                [inboundEnvelope],
            ).map(
                (row) =>
                    ({ ...row, kind: "message" as const }) satisfies ChatTimelineMessageRow,
            );
            return {
                ...prev,
                [spaceId]: sortTimelineRows([...callEvents, ...mergedMessages]),
            };
        });

        void persistGroupHistoryMessage({
            spaceUuid: envelope.spaceUuid,
            from: envelope.from,
            body: envelope.body,
            sendTimestamp: envelope.sendTimestamp,
            clientMsgId: envelope.clientMsgId,
        });

        globalThis.setTimeout(() => flushPendingMessagesRef.current(), 0);
        return "accepted";
    };
}

export type ApplyInboundDmHistorySyncDeps = {
    selfRef: MutableRefObject<string | null>;
    conversationsRef: MutableRefObject<ConversationSnapshot[]>;
    contactAccountsRef: MutableRefObject<Set<string>>;
    contactsLoadedRef: MutableRefObject<boolean>;
    transportBridgeRef: MutableRefObject<ChatTransportBridge | null>;
    chainIdRef: MutableRefObject<string>;
    setLastInboundError: (value: string | null) => void;
    setTimelineByConversation: Dispatch<
        SetStateAction<Record<string, ChatTimelineRow[]>>
    >;
    flushPendingMessagesRef: MutableRefObject<() => void>;
};

export function createApplyInboundDmHistorySync(deps: ApplyInboundDmHistorySyncDeps) {
    const {
        selfRef,
        conversationsRef,
        contactAccountsRef,
        contactsLoadedRef,
        transportBridgeRef,
        chainIdRef,
        setLastInboundError,
        setTimelineByConversation,
        flushPendingMessagesRef,
    } = deps;

    return async (envelope: ChatHistorySyncEnvelope) => {
        const self = selfRef.current;
        if (!self) return;

        const conversation = conversationsRef.current.find(
            (row) => row.conversationId === envelope.spaceUuid,
        );
        if (conversation?.kind !== "dm") return;

        const peer = dmPeerAccount(conversation.members, self);
        if (
            !peer ||
            !isInboundContactPeer(
                self,
                peer,
                contactAccountsRef.current,
                contactsLoadedRef.current,
            )
        ) {
            return;
        }

        const incoming = historySyncToDmEnvelopes(
            self,
            envelope.spaceUuid,
            peer,
            envelope,
        );
        if (incoming.length === 0) return;

        for (const target of listInboundAckTargets(incoming, self)) {
            transportBridgeRef.current?.messaging?.acknowledgeInbound(
                target.remote,
                target.spaceUuid,
                target.clientMsgId,
            );
        }

        const chain = chainIdRef.current;
        if (chain) {
            try {
                const store = getDmMessageHistoryStore(chain, self);
                for (const row of incoming) {
                    await store.append(row);
                }
            } catch (e) {
                const detail =
                    e instanceof Error
                        ? e.message
                        : "Could not persist synced DM history.";
                setLastInboundError(
                    `DM history sync storage failed: ${detail}. Synced messages may not survive refresh in this browser.`,
                );
            }

            if (incoming.some((row) => row.from === peer)) {
                markDeliveryOpenPeer(chain, self, peer);
            }
        }

        setTimelineByConversation((prev) => {
            const spaceUuid = envelope.spaceUuid;
            const existing = prev[spaceUuid] ?? [];
            const callEvents = existing.filter((row) => row.kind === "callEvent");
            const existingMessages = existing.filter(
                (row): row is ChatTimelineMessageRow => row.kind === "message",
            );
            const mergedMessages = mergeTimelineMessagesBySendTimestamp(
                existingMessages.filter((row) => row.status === "sent"),
                incoming,
            ).map((row) => {
                const pending = existingMessages.find(
                    (existingRow) =>
                        existingRow.clientMsgId &&
                        existingRow.clientMsgId === row.clientMsgId &&
                        existingRow.status !== "sent",
                );
                return pending
                    ? ({
                          ...row,
                          ...pending,
                          kind: "message" as const,
                      } satisfies ChatTimelineMessageRow)
                    : ({ ...row, kind: "message" as const } satisfies ChatTimelineMessageRow);
            });
            return {
                ...prev,
                [spaceUuid]: sortTimelineRows([...callEvents, ...mergedMessages]),
            };
        });

        globalThis.setTimeout(() => flushPendingMessagesRef.current(), 0);
    };
}

export type ApplyInboundGroupHistorySyncDeps = {
    selfRef: MutableRefObject<string | null>;
    conversationsRef: MutableRefObject<ConversationSnapshot[]>;
    objectiveSpacesRef: MutableRefObject<GraphqlSpaceEntry[]>;
    transportBridgeRef: MutableRefObject<ChatTransportBridge | null>;
    chainIdRef: MutableRefObject<string>;
    setLastInboundError: (value: string | null) => void;
    setTimelineByConversation: Dispatch<
        SetStateAction<Record<string, ChatTimelineRow[]>>
    >;
    flushPendingMessagesRef: MutableRefObject<() => void>;
};

export function createApplyInboundGroupHistorySync(
    deps: ApplyInboundGroupHistorySyncDeps,
) {
    const {
        selfRef,
        conversationsRef,
        objectiveSpacesRef,
        transportBridgeRef,
        chainIdRef,
        setLastInboundError,
        setTimelineByConversation,
        flushPendingMessagesRef,
    } = deps;

    return async (envelope: ChatHistorySyncEnvelope) => {
        const self = selfRef.current;
        if (!self) return;

        const members = resolveGroupMembersForHistorySync(
            envelope.spaceUuid,
            conversationsRef.current,
            objectiveSpacesRef.current,
        );
        if (!members) return;

        const incoming = historySyncToGroupEnvelopes(
            self,
            envelope.spaceUuid,
            envelope,
        ).filter((row) => members.includes(row.from));
        if (incoming.length === 0) return;

        for (const target of listInboundAckTargets(incoming, self)) {
            transportBridgeRef.current?.messaging?.acknowledgeInbound(
                target.remote,
                target.spaceUuid,
                target.clientMsgId,
            );
        }

        const chain = chainIdRef.current;
        if (chain) {
            for (const row of incoming) {
                if (row.from !== self) {
                    markDeliveryOpenPeer(chain, self, row.from);
                }
            }
            try {
                const store = getGroupMessageHistoryStore(chain, self);
                for (const row of incoming) {
                    await store.append(row);
                }
            } catch (e) {
                const detail =
                    e instanceof Error
                        ? e.message
                        : "Could not persist synced group history.";
                setLastInboundError(
                    `Group history sync storage failed: ${detail}. Synced messages may not survive refresh in this browser.`,
                );
            }
        }

        setTimelineByConversation((prev) => {
            const spaceUuid = envelope.spaceUuid;
            const existing = prev[spaceUuid] ?? [];
            const callEvents = existing.filter((row) => row.kind === "callEvent");
            const existingMessages = existing.filter(
                (row): row is ChatTimelineMessageRow => row.kind === "message",
            );
            const mergedMessages = mergeTimelineMessagesWithGroupHistory(
                existingMessages,
                incoming,
            ).map(
                (row) =>
                    ({ ...row, kind: "message" as const }) satisfies ChatTimelineMessageRow,
            );
            return {
                ...prev,
                [spaceUuid]: sortTimelineRows([...callEvents, ...mergedMessages]),
            };
        });

        globalThis.setTimeout(() => flushPendingMessagesRef.current(), 0);
    };
}

export type PushDmHistorySyncDeps = {
    selfRef: MutableRefObject<string | null>;
    chainIdRef: MutableRefObject<string>;
    transportBridgeRef: MutableRefObject<ChatTransportBridge | null>;
    setLastInboundError: (value: string | null) => void;
};

export function createPushDmHistorySync(deps: PushDmHistorySyncDeps) {
    const { selfRef, chainIdRef, transportBridgeRef, setLastInboundError } = deps;

    return async (spaceUuid: string, peerAccount: string) => {
        const self = selfRef.current;
        if (!self) return;

        const chain = chainIdRef.current;
        if (!chain) return;

        try {
            const store = getDmMessageHistoryStore(chain, self);
            const envelopes = await store.listBySpace(spaceUuid);
            const payload = {
                t: "chatHistorySync" as const,
                spaceUuid,
                messages: envelopesToHistorySyncMessages(envelopes),
            };
            const bridge = transportBridgeRef.current;
            const sent =
                bridge?.sendHistorySync(spaceUuid, peerAccount, payload) ?? false;
            if (!sent) {
                enqueueHistorySyncPush(chain, self, {
                    peerAccount,
                    spaceUuid,
                    kind: "dm",
                    enqueuedAt: Date.now(),
                });
            } else {
                dequeueHistorySyncPush(chain, self, peerAccount, spaceUuid, "dm");
            }
        } catch (e) {
            const detail =
                e instanceof Error
                    ? e.message
                    : "Could not read local DM history for sync.";
            setLastInboundError(
                `DM history sync failed: ${detail}. Peer may be missing prior messages.`,
            );
        }
    };
}

export type PushGroupHistorySyncDeps = {
    selfRef: MutableRefObject<string | null>;
    chainIdRef: MutableRefObject<string>;
    transportBridgeRef: MutableRefObject<ChatTransportBridge | null>;
    setLastInboundError: (value: string | null) => void;
};

export function createPushGroupHistorySync(deps: PushGroupHistorySyncDeps) {
    const { selfRef, chainIdRef, transportBridgeRef, setLastInboundError } = deps;

    return async (spaceUuid: string, peerAccount: string) => {
        const self = selfRef.current;
        if (!self) return;

        const chain = chainIdRef.current;
        if (!chain) return;

        try {
            const store = getGroupMessageHistoryStore(chain, self);
            const envelopes = await store.listBySpace(spaceUuid);
            const payload = {
                t: "chatHistorySync" as const,
                spaceUuid,
                messages: envelopesToHistorySyncMessages(envelopes),
            };
            const bridge = transportBridgeRef.current;
            const sent =
                bridge?.sendGroupHistorySync(spaceUuid, peerAccount, payload) ??
                false;
            if (!sent) {
                enqueueHistorySyncPush(chain, self, {
                    peerAccount,
                    spaceUuid,
                    kind: "group",
                    enqueuedAt: Date.now(),
                });
            } else {
                dequeueHistorySyncPush(chain, self, peerAccount, spaceUuid, "group");
            }
        } catch (e) {
            const detail =
                e instanceof Error
                    ? e.message
                    : "Could not read local group history for sync.";
            setLastInboundError(
                `Group history sync failed: ${detail}. Peer may be missing prior messages.`,
            );
        }
    };
}

export type DrainHistorySyncPushForPeerDeps = {
    selfRef: MutableRefObject<string | null>;
    chainIdRef: MutableRefObject<string>;
    pushDmHistorySync: (spaceUuid: string, peerAccount: string) => Promise<void>;
    pushGroupHistorySync: (spaceUuid: string, peerAccount: string) => Promise<void>;
};

export function createDrainHistorySyncPushForPeer(
    deps: DrainHistorySyncPushForPeerDeps,
) {
    const { selfRef, chainIdRef, pushDmHistorySync, pushGroupHistorySync } = deps;

    return async (peerAccount: string) => {
        const self = selfRef.current;
        const chain = chainIdRef.current;
        if (!self || !chain) return;

        for (const record of historySyncPushForPeer(chain, self, peerAccount)) {
            if (record.kind === "group") {
                await pushGroupHistorySync(record.spaceUuid, peerAccount);
            } else {
                await pushDmHistorySync(record.spaceUuid, peerAccount);
            }
        }
    };
}
