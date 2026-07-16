import {
    type MutableRefObject,
    useCallback,
    useEffect,
    useRef,
} from "react";

import type {
    ChatTimelineCallEventRow,
    ChatTimelineMessageRow,
    ChatTimelineRow,
} from "../../lib/chat-timeline-types";
import type { ConversationSnapshot } from "../../lib/protocol";

import { mergeObjectiveCallEventsIntoTimeline } from "../../lib/call-timeline-bridge";
import { fetchSpaceCallEvents } from "../../lib/chat-api";
import { sortTimelineRows } from "../../lib/chat-timeline-types";
import {
    seedDeliveryOpenPeersFromGroupHistory,
    seedDeliveryOpenPeersFromHistory,
} from "../../lib/delivery-open-peers";
import {
    buildDmEnvelope,
    dmPeerAccount,
    getDmMessageHistoryStore,
} from "../../lib/dm-message-history-store";
import { mergeTimelineMessagesBySendTimestamp } from "../../lib/dm-message-history-ui";
import {
    buildGroupEnvelope,
    getGroupMessageHistoryStore,
} from "../../lib/group-message-history-store";
import { mergeTimelineMessagesWithGroupHistory } from "../../lib/group-message-history-ui";
import type { PendingChatMessage } from "../../lib/pending-message-store";
import type { GraphqlSpaceEntry } from "../../lib/space-bridge";

export type PersistHistoryMessageInput = {
    spaceUuid: string;
    from: string;
    body: string;
    sendTimestamp: number;
    clientMsgId?: string;
    serverMsgId?: number;
    fallbackKey?: string;
};

export type UseChatHistoryParams = {
    chainId: string;
    chainIdRef: MutableRefObject<string>;
    selfAccount: string | null;
    selfRef: MutableRefObject<string | null>;
    objectiveSpaces: GraphqlSpaceEntry[];
    objectiveSpacesRef: MutableRefObject<GraphqlSpaceEntry[]>;
    conversationsRef: MutableRefObject<ConversationSnapshot[]>;
    pendingMessagesRef: MutableRefObject<Record<string, PendingChatMessage>>;
    flushPendingMessagesRef: MutableRefObject<() => void>;
    setTimelineByConversation: React.Dispatch<
        React.SetStateAction<Record<string, ChatTimelineRow[]>>
    >;
    setLastInboundError: (value: string | null) => void;
};

export type UseChatHistoryResult = {
    persistDmHistoryMessage: (
        input: PersistHistoryMessageInput,
    ) => Promise<void>;
    persistGroupHistoryMessage: (
        input: PersistHistoryMessageInput,
    ) => Promise<void>;
    restoreDmHistoryFromStore: (account: string) => Promise<void>;
    restoreGroupHistoryFromStore: (account: string) => Promise<void>;
    refreshObjectiveCallEventsForSpace: (spaceUuid: string) => Promise<void>;
    refreshObjectiveCallEventsForSpaceRef: MutableRefObject<
        (spaceUuid: string) => Promise<void>
    >;
    restoreObjectiveCallEvents: () => Promise<void>;
};

/** DM/group message history restore + persist, plus objective call-event sync. */
export function useChatHistory(
    params: UseChatHistoryParams,
): UseChatHistoryResult {
    const {
        chainId,
        chainIdRef,
        selfAccount,
        selfRef,
        objectiveSpaces,
        objectiveSpacesRef,
        conversationsRef,
        pendingMessagesRef,
        flushPendingMessagesRef,
        setTimelineByConversation,
        setLastInboundError,
    } = params;

    const persistDmHistoryMessage = useCallback(
        async (input: PersistHistoryMessageInput) => {
            const self = selfRef.current;
            if (!self) return;
            const space =
                objectiveSpacesRef.current.find(
                    (row) => row.space_uuid === input.spaceUuid,
                ) ??
                conversationsRef.current.find(
                    (row) => row.conversationId === input.spaceUuid,
                );
            const members =
                space && "members" in space ? space.members : undefined;
            if (!members) return;
            const peer = dmPeerAccount(members, self);
            if (!peer) return;
            const chain = chainIdRef.current;
            if (!chain) return;
            try {
                await getDmMessageHistoryStore(chain, self).append(
                    buildDmEnvelope({
                        ownerAccount: self,
                        spaceUuid: input.spaceUuid,
                        peerAccount: peer,
                        from: input.from,
                        body: input.body,
                        sendTimestamp: input.sendTimestamp,
                        clientMsgId: input.clientMsgId,
                        serverMsgId: input.serverMsgId,
                        fallbackKey: input.fallbackKey,
                    }),
                );
            } catch (e) {
                const detail =
                    e instanceof Error
                        ? e.message
                        : "Could not persist DM message history.";
                setLastInboundError(
                    `DM history storage failed: ${detail}. Messages may not survive refresh in this browser.`,
                );
            }
        },
        [],
    );

    const persistGroupHistoryMessage = useCallback(
        async (input: PersistHistoryMessageInput) => {
            const self = selfRef.current;
            if (!self) return;
            const space =
                objectiveSpacesRef.current.find(
                    (row) => row.space_uuid === input.spaceUuid,
                ) ??
                conversationsRef.current.find(
                    (row) => row.conversationId === input.spaceUuid,
                );
            if (!space) return;
            const isGroup =
                ("space_uuid" in space && space.kind === "GROUP") ||
                ("conversationId" in space && space.kind === "group");
            if (!isGroup) return;
            const chain = chainIdRef.current;
            if (!chain) return;
            try {
                await getGroupMessageHistoryStore(chain, self).append(
                    buildGroupEnvelope({
                        ownerAccount: self,
                        spaceUuid: input.spaceUuid,
                        from: input.from,
                        body: input.body,
                        sendTimestamp: input.sendTimestamp,
                        clientMsgId: input.clientMsgId,
                        serverMsgId: input.serverMsgId,
                        fallbackKey: input.fallbackKey,
                    }),
                );
            } catch (e) {
                const detail =
                    e instanceof Error
                        ? e.message
                        : "Could not persist group message history.";
                setLastInboundError(
                    `Group history storage failed: ${detail}. Messages may not survive refresh in this browser.`,
                );
            }
        },
        [],
    );

    const restoreDmHistoryFromStore = useCallback(async (account: string) => {
        const chain = chainIdRef.current;
        if (!chain) return;

        const dmSpaces = objectiveSpacesRef.current.filter(
            (space) => space.kind === "DM",
        );
        if (dmSpaces.length === 0) return;

        try {
            const store = getDmMessageHistoryStore(chain, account);
            const historyBySpace = await Promise.all(
                dmSpaces.map(async (space) => ({
                    spaceUuid: space.space_uuid,
                    envelopes: await store.listBySpace(space.space_uuid),
                })),
            );

            const pendingClientMsgIds = new Set(
                Object.values(pendingMessagesRef.current)
                    .filter((row) => row.status === "pending")
                    .map((row) => row.clientMsgId),
            );
            const seeded = seedDeliveryOpenPeersFromHistory(
                chain,
                account,
                historyBySpace.flatMap((row) => row.envelopes),
                { pendingClientMsgIds },
            );
            if (seeded > 0) {
                globalThis.setTimeout(
                    () => flushPendingMessagesRef.current(),
                    0,
                );
            }

            setTimelineByConversation((prev) => {
                const next = { ...prev };
                for (const { spaceUuid, envelopes } of historyBySpace) {
                    if (envelopes.length === 0) continue;
                    const existing = prev[spaceUuid] ?? [];
                    const callEvents = existing.filter(
                        (row) => row.kind === "callEvent",
                    );
                    const existingMessages = existing.filter(
                        (row): row is ChatTimelineMessageRow =>
                            row.kind === "message",
                    );
                    const mergedMessages = mergeTimelineMessagesBySendTimestamp(
                        existingMessages.filter((row) => row.status === "sent"),
                        envelopes,
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
                            : ({
                                  ...row,
                                  kind: "message" as const,
                              } satisfies ChatTimelineMessageRow);
                    });
                    next[spaceUuid] = sortTimelineRows([
                        ...callEvents,
                        ...mergedMessages,
                    ]);
                }
                return next;
            });
        } catch (e) {
            const detail =
                e instanceof Error
                    ? e.message
                    : "Could not restore DM message history.";
            setLastInboundError(
                `DM history storage is unavailable or corrupted: ${detail}. Prior messages cannot be restored in this browser.`,
            );
        }
    }, []);

    useEffect(() => {
        if (!chainId || !selfAccount) return;
        if (!objectiveSpaces.some((space) => space.kind === "DM")) return;
        void restoreDmHistoryFromStore(selfAccount);
    }, [chainId, selfAccount, objectiveSpaces, restoreDmHistoryFromStore]);

    const restoreGroupHistoryFromStore = useCallback(
        async (account: string) => {
            const chain = chainIdRef.current;
            if (!chain) return;

            const groupSpaces = objectiveSpacesRef.current.filter(
                (space) => space.kind === "GROUP",
            );
            if (groupSpaces.length === 0) return;

            try {
                const store = getGroupMessageHistoryStore(chain, account);
                const historyBySpace = await Promise.all(
                    groupSpaces.map(async (space) => ({
                        spaceUuid: space.space_uuid,
                        envelopes: await store.listBySpace(space.space_uuid),
                    })),
                );

                const pendingClientMsgIds = new Set(
                    Object.values(pendingMessagesRef.current)
                        .filter((row) => row.status === "pending")
                        .map((row) => row.clientMsgId),
                );
                const groupSpacesForSeed = groupSpaces.map((space) => ({
                    spaceUuid: space.space_uuid,
                    members: space.members,
                }));
                const seeded = seedDeliveryOpenPeersFromGroupHistory(
                    chain,
                    account,
                    historyBySpace.flatMap((row) => row.envelopes),
                    groupSpacesForSeed,
                    {
                        pendingClientMsgIds,
                        pendingDeliveredTo: Object.values(
                            pendingMessagesRef.current,
                        ),
                    },
                );
                if (seeded > 0) {
                    globalThis.setTimeout(
                        () => flushPendingMessagesRef.current(),
                        0,
                    );
                }

                setTimelineByConversation((prev) => {
                    const next = { ...prev };
                    for (const { spaceUuid, envelopes } of historyBySpace) {
                        if (envelopes.length === 0) continue;
                        const existing = prev[spaceUuid] ?? [];
                        const callEvents = existing.filter(
                            (row) => row.kind === "callEvent",
                        );
                        const existingMessages = existing.filter(
                            (row): row is ChatTimelineMessageRow =>
                                row.kind === "message",
                        );
                        const mergedMessages =
                            mergeTimelineMessagesWithGroupHistory(
                                existingMessages,
                                envelopes,
                            ).map(
                                (row) =>
                                    ({
                                        ...row,
                                        kind: "message" as const,
                                    }) satisfies ChatTimelineMessageRow,
                            );
                        next[spaceUuid] = sortTimelineRows([
                            ...callEvents,
                            ...mergedMessages,
                        ]);
                    }
                    return next;
                });
            } catch (e) {
                const detail =
                    e instanceof Error
                        ? e.message
                        : "Could not restore group message history.";
                setLastInboundError(
                    `Group history storage is unavailable or corrupted: ${detail}. Prior messages cannot be restored in this browser.`,
                );
            }
        },
        [],
    );

    useEffect(() => {
        if (!chainId || !selfAccount) return;
        if (!objectiveSpaces.some((space) => space.kind === "GROUP")) return;
        void restoreGroupHistoryFromStore(selfAccount);
    }, [chainId, selfAccount, objectiveSpaces, restoreGroupHistoryFromStore]);

    const refreshObjectiveCallEventsForSpace = useCallback(
        async (spaceUuid: string) => {
            try {
                const events = await fetchSpaceCallEvents(spaceUuid);
                setTimelineByConversation((prev) => {
                    const existing = prev[spaceUuid] ?? [];
                    const wsCallEvents = existing.filter(
                        (row): row is ChatTimelineCallEventRow =>
                            row.kind === "callEvent" &&
                            !row.key.startsWith("obj-"),
                    );
                    const objectiveExisting = existing.filter(
                        (row): row is ChatTimelineCallEventRow =>
                            row.kind === "callEvent" &&
                            row.key.startsWith("obj-"),
                    );
                    const messages = existing.filter(
                        (row): row is ChatTimelineMessageRow =>
                            row.kind === "message",
                    );
                    const mergedObjective =
                        mergeObjectiveCallEventsIntoTimeline(
                            objectiveExisting,
                            events,
                        );
                    return {
                        ...prev,
                        [spaceUuid]: sortTimelineRows([
                            ...wsCallEvents,
                            ...mergedObjective,
                            ...messages,
                        ]),
                    };
                });
            } catch {
                // Non-fatal; subjective callEvent frames may still arrive.
            }
        },
        [],
    );

    const refreshObjectiveCallEventsForSpaceRef = useRef(
        refreshObjectiveCallEventsForSpace,
    );
    refreshObjectiveCallEventsForSpaceRef.current =
        refreshObjectiveCallEventsForSpace;

    const restoreObjectiveCallEvents = useCallback(async () => {
        const spaces = objectiveSpacesRef.current;
        if (spaces.length === 0) return;
        await Promise.all(
            spaces.map((space) =>
                refreshObjectiveCallEventsForSpaceRef.current(space.space_uuid),
            ),
        );
    }, []);

    useEffect(() => {
        if (!selfAccount || objectiveSpaces.length === 0) return;
        void restoreObjectiveCallEvents();
    }, [selfAccount, objectiveSpaces, restoreObjectiveCallEvents]);

    return {
        persistDmHistoryMessage,
        persistGroupHistoryMessage,
        restoreDmHistoryFromStore,
        restoreGroupHistoryFromStore,
        refreshObjectiveCallEventsForSpace,
        refreshObjectiveCallEventsForSpaceRef,
        restoreObjectiveCallEvents,
    };
}
