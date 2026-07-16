import type { Dispatch, MutableRefObject, SetStateAction } from "react";

import type { ChatTimelineMessageRow, ChatTimelineRow } from "../../lib/chat-timeline-types";
import {
    pendingRecipientCount,
    pendingToTimelineRow,
    sortTimelineRows,
} from "../../lib/chat-timeline-types";
import { markDeliveryOpenPeer } from "../../lib/delivery-open-peers";
import {
    type PendingChatMessage,
    type PendingMessageStoreError,
    savePendingMessagesWithQuotaRecovery,
} from "../../lib/pending-message-store";
import { spaceUuidFromConversationId } from "../../lib/space-bridge";
import { ChatTransportBridge } from "../../transport/chat-transport-bridge";

/**
 * Pending-message persistence (localStorage quota recovery), the
 * pending → timeline projection, and the delivery-flush trigger. Deliberately
 * excludes inbound-message application and outbound send/compose — see
 * `chat-messaging-inbound.ts` and `chat-messaging-send.ts`.
 */

export type PersistPendingMessagesDeps = {
    selfRef: MutableRefObject<string | null>;
    chainIdRef: MutableRefObject<string>;
    setLastInboundError: (value: string | null) => void;
    setPendingStorageQuotaExceeded: (value: boolean) => void;
    storageFailureRef: MutableRefObject<string | null>;
    lastQuotaPromotedRef: MutableRefObject<readonly PendingChatMessage[]>;
};

export function createPersistPendingMessages(deps: PersistPendingMessagesDeps) {
    const {
        selfRef,
        chainIdRef,
        setLastInboundError,
        setPendingStorageQuotaExceeded,
        storageFailureRef,
        lastQuotaPromotedRef,
    } = deps;

    return (next: Record<string, PendingChatMessage>): boolean => {
        const self = selfRef.current;
        const chain = chainIdRef.current;
        if (!self || !chain) return true;
        const rows = Object.values(next);
        const result = savePendingMessagesWithQuotaRecovery(chain, self, rows, {
            onWriteError: (err: PendingMessageStoreError) => {
                storageFailureRef.current = err.detail;
                if (err.kind === "quota-exceeded") {
                    setPendingStorageQuotaExceeded(true);
                    setLastInboundError(
                        `Pending message storage is full: ${err.detail}. Oldest pending messages were marked as failed to free space.`,
                    );
                } else {
                    setLastInboundError(
                        `Pending message storage failed: ${err.detail}. This browser cannot safely queue offline messages.`,
                    );
                }
            },
        });
        if (result.ok) {
            storageFailureRef.current = null;
            lastQuotaPromotedRef.current = result.promoted;
            if (result.promoted.length === 0) {
                setPendingStorageQuotaExceeded(false);
            }
            return true;
        }
        lastQuotaPromotedRef.current = [];
        return false;
    };
}

export type DrainQuotaPromotionsDeps = {
    lastQuotaPromotedRef: MutableRefObject<readonly PendingChatMessage[]>;
    pendingMessagesRef: MutableRefObject<Record<string, PendingChatMessage>>;
    setPendingMessages: Dispatch<SetStateAction<Record<string, PendingChatMessage>>>;
    upsertPendingTimelineRowRef: MutableRefObject<
        (pending: PendingChatMessage) => void
    >;
};

/**
 * After a `persistPendingMessages` call that triggered quota recovery, apply
 * the resulting `failed` promotions to the in-memory map and the timeline.
 */
export function createDrainQuotaPromotions(deps: DrainQuotaPromotionsDeps) {
    const {
        lastQuotaPromotedRef,
        pendingMessagesRef,
        setPendingMessages,
        upsertPendingTimelineRowRef,
    } = deps;

    return () => {
        const promoted = lastQuotaPromotedRef.current;
        if (promoted.length === 0) return;
        lastQuotaPromotedRef.current = [];
        const merged = { ...pendingMessagesRef.current };
        for (const row of promoted) {
            merged[row.clientMsgId] = row;
        }
        pendingMessagesRef.current = merged;
        setPendingMessages(merged);
        for (const row of promoted) {
            upsertPendingTimelineRowRef.current(row);
        }
    };
}

export type ReplacePendingMessagesDeps = {
    setPendingMessages: Dispatch<SetStateAction<Record<string, PendingChatMessage>>>;
    pendingMessagesRef: MutableRefObject<Record<string, PendingChatMessage>>;
    persistPendingMessages: (next: Record<string, PendingChatMessage>) => boolean;
    drainQuotaPromotions: () => void;
};

export function createReplacePendingMessages(deps: ReplacePendingMessagesDeps) {
    const { setPendingMessages, pendingMessagesRef, persistPendingMessages, drainQuotaPromotions } =
        deps;

    return (
        updater: (
            prev: Record<string, PendingChatMessage>,
        ) => Record<string, PendingChatMessage>,
    ) => {
        setPendingMessages((prev) => {
            const next = updater(prev);
            pendingMessagesRef.current = next;
            persistPendingMessages(next);
            return next;
        });
        drainQuotaPromotions();
    };
}

export type UpsertPendingTimelineRowDeps = {
    setTimelineByConversation: Dispatch<
        SetStateAction<Record<string, ChatTimelineRow[]>>
    >;
};

export function createUpsertPendingTimelineRow(deps: UpsertPendingTimelineRowDeps) {
    const { setTimelineByConversation } = deps;

    return (pending: PendingChatMessage) => {
        const row = pendingToTimelineRow(pending);
        const spaceId = spaceUuidFromConversationId(pending.conversationId);
        setTimelineByConversation((prev) => {
            const list = [...(prev[spaceId] ?? [])];
            const ix = list.findIndex(
                (item) =>
                    item.kind === "message" &&
                    item.clientMsgId === pending.clientMsgId,
            );
            if (ix >= 0) list[ix] = { ...list[ix], ...row };
            else list.push(row);
            return {
                ...prev,
                [spaceId]: sortTimelineRows(list),
            };
        });
    };
}

export type MarkDmPendingDeliveredDeps = {
    selfRef: MutableRefObject<string | null>;
    chainIdRef: MutableRefObject<string>;
    inFlightDeliveriesRef: MutableRefObject<Set<string>>;
    replacePendingMessages: (
        updater: (
            prev: Record<string, PendingChatMessage>,
        ) => Record<string, PendingChatMessage>,
    ) => void;
    upsertPendingTimelineRow: (pending: PendingChatMessage) => void;
    setTimelineByConversation: Dispatch<
        SetStateAction<Record<string, ChatTimelineRow[]>>
    >;
};

export function createMarkDmPendingDelivered(deps: MarkDmPendingDeliveredDeps) {
    const {
        selfRef,
        chainIdRef,
        inFlightDeliveriesRef,
        replacePendingMessages,
        upsertPendingTimelineRow,
        setTimelineByConversation,
    } = deps;

    return (clientMsgId: string, recipient: string, spaceId: string) => {
        const self = selfRef.current;
        if (!self) return;
        const chain = chainIdRef.current;
        if (chain) {
            markDeliveryOpenPeer(chain, self, recipient);
        }
        inFlightDeliveriesRef.current.delete(`${clientMsgId}:${recipient}`);
        let nextPending: PendingChatMessage | undefined;
        replacePendingMessages((prev) => {
            const cur = prev[clientMsgId];
            if (!cur) return prev;
            const deliveredTo = [...new Set([...cur.deliveredTo, recipient])];
            const complete = cur.recipients.every((r) => deliveredTo.includes(r));
            if (complete) {
                const { [clientMsgId]: _sent, ...rest } = prev;
                return rest;
            }
            nextPending = {
                ...cur,
                deliveredTo,
                status: "pending",
            };
            return { ...prev, [clientMsgId]: nextPending };
        });
        if (nextPending) upsertPendingTimelineRow(nextPending);
        setTimelineByConversation((prev) => {
            for (const [sid, list] of Object.entries(prev)) {
                const prevList = [...list];
                const ix = prevList.findIndex(
                    (m) => m.kind === "message" && m.clientMsgId === clientMsgId,
                );
                if (ix < 0) continue;
                const cur = prevList[ix] as ChatTimelineMessageRow;
                prevList[ix] = {
                    ...cur,
                    status: nextPending ? "pending" : "sent",
                    pendingRecipientCount: nextPending
                        ? pendingRecipientCount(nextPending)
                        : undefined,
                };
                return { ...prev, [sid]: prevList };
            }
            if (spaceId) {
                const prevList = [...(prev[spaceId] ?? [])];
                const ix = prevList.findIndex(
                    (m) => m.kind === "message" && m.clientMsgId === clientMsgId,
                );
                if (ix >= 0) {
                    const cur = prevList[ix] as ChatTimelineMessageRow;
                    prevList[ix] = {
                        ...cur,
                        status: nextPending ? "pending" : "sent",
                        pendingRecipientCount: nextPending
                            ? pendingRecipientCount(nextPending)
                            : undefined,
                    };
                    return { ...prev, [spaceId]: prevList };
                }
            }
            return prev;
        });
    };
}

export type FlushPendingMessagesDeps = {
    transportBridgeRef: MutableRefObject<ChatTransportBridge | null>;
};

export function createFlushPendingMessages(deps: FlushPendingMessagesDeps) {
    const { transportBridgeRef } = deps;
    return () => {
        transportBridgeRef.current?.messaging?.hydrateFromStorage();
    };
}

export type SchedulePendingFlushDeps = {
    leavingChatRef: MutableRefObject<boolean>;
    flushPendingMessagesRef: MutableRefObject<() => void>;
};

export function createSchedulePendingFlush(deps: SchedulePendingFlushDeps) {
    const { leavingChatRef, flushPendingMessagesRef } = deps;
    return () => {
        if (leavingChatRef.current) return;
        flushPendingMessagesRef.current();
    };
}
