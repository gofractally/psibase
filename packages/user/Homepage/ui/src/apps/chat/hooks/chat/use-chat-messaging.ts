import {
    type Dispatch,
    type MutableRefObject,
    type SetStateAction,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";

import type {
    ChatDataMessageEnvelope,
    ChatHistorySyncEnvelope,
} from "../../lib/chat-data-envelope";
import type { ChatTimelineRow } from "../../lib/chat-timeline-types";
import type { InboundMessageAcceptance } from "../../lib/inbound-message-acceptance";
import type { PendingChatMessage } from "../../lib/pending-message-store";
import type { ConversationSnapshot } from "../../lib/protocol";
import type { GraphqlSpaceEntry } from "../../lib/space-bridge";
import { ChatTransportBridge } from "../../transport/chat-transport-bridge";
import {
    createApplyInboundChatMessage,
    createApplyInboundDmDataChannelMessage,
    createApplyInboundDmHistorySync,
    createApplyInboundGroupDataChannelMessage,
    createApplyInboundGroupHistorySync,
    createDrainHistorySyncPushForPeer,
    createPushDmHistorySync,
    createPushGroupHistorySync,
} from "./chat-messaging-inbound";
import {
    createDrainQuotaPromotions,
    createFlushPendingMessages,
    createMarkDmPendingDelivered,
    createPersistPendingMessages,
    createReplacePendingMessages,
    createSchedulePendingFlush,
    createUpsertPendingTimelineRow,
} from "./chat-messaging-pending";
import {
    createEnqueueOutboundChatMessage,
    createOpenGroupChat,
    createOpenOrFocusDm,
    createScheduleDmChatDataSession,
    createScheduleGroupChatDataSession,
    createSelectSpaceByMembers,
    createSendChatMessage,
} from "./chat-messaging-send";
import type { PersistHistoryMessageInput } from "./use-chat-history";

export type UseChatMessagingParams = {
    selfRef: MutableRefObject<string | null>;
    chainIdRef: MutableRefObject<string>;
    contactAccountsRef: MutableRefObject<Set<string>>;
    contactsLoadedRef: MutableRefObject<boolean>;
    conversationsRef: MutableRefObject<ConversationSnapshot[]>;
    objectiveSpacesRef: MutableRefObject<GraphqlSpaceEntry[]>;
    transportBridgeRef: MutableRefObject<ChatTransportBridge | null>;
    connectionState: string;
    presenceReady: boolean;
    leavingChatRef: MutableRefObject<boolean>;
    selectedConversationId: string | undefined;
    selectedConversationIdRef: MutableRefObject<string | undefined>;
    setSelectedConversationId: (
        id: string | undefined,
        source?: string,
    ) => void;
    composePendingDmPeer: string | null;
    composePendingDmPeerRef: MutableRefObject<string | null>;
    setComposePendingDmPeer: (value: string | null) => void;
    pendingDmMemberRef: MutableRefObject<string | null>;
    resolveConversationSync: (
        spaceUuid: string,
    ) => ConversationSnapshot | undefined;
    loadObjectiveSpaces: () => Promise<GraphqlSpaceEntry[]>;
    setLastInboundError: (value: string | null) => void;
    setUnreadByConversation: Dispatch<SetStateAction<Record<string, number>>>;
    setTimelineByConversation: Dispatch<
        SetStateAction<Record<string, ChatTimelineRow[]>>
    >;
    persistDmHistoryMessage: (
        input: PersistHistoryMessageInput,
    ) => Promise<void>;
    persistGroupHistoryMessage: (
        input: PersistHistoryMessageInput,
    ) => Promise<void>;
    pendingMessagesRef: MutableRefObject<Record<string, PendingChatMessage>>;
    flushPendingMessagesRef: MutableRefObject<() => void>;
};

export type UseChatMessagingResult = {
    pendingMessages: Record<string, PendingChatMessage>;
    setPendingMessages: Dispatch<SetStateAction<Record<string, PendingChatMessage>>>;
    pendingStorageQuotaExceeded: boolean;
    storageFailureRef: MutableRefObject<string | null>;
    upsertPendingTimelineRow: (pending: PendingChatMessage) => void;
    applyInboundChatMessage: (frame: {
        conversationId: string;
        from: string;
        body: string;
        serverMsgId?: number;
        serverTime: number;
        clientMsgId?: string;
        clientTime?: number;
    }) => void;
    applyInboundDmDataChannelMessageRef: MutableRefObject<
        (envelope: ChatDataMessageEnvelope) => InboundMessageAcceptance
    >;
    applyInboundGroupDataChannelMessageRef: MutableRefObject<
        (envelope: ChatDataMessageEnvelope) => InboundMessageAcceptance
    >;
    applyInboundDmHistorySyncRef: MutableRefObject<
        (envelope: ChatHistorySyncEnvelope) => Promise<void>
    >;
    applyInboundGroupHistorySyncRef: MutableRefObject<
        (envelope: ChatHistorySyncEnvelope) => Promise<void>
    >;
    pushDmHistorySyncRef: MutableRefObject<
        (spaceUuid: string, peerAccount: string) => Promise<void>
    >;
    pushGroupHistorySyncRef: MutableRefObject<
        (spaceUuid: string, peerAccount: string) => Promise<void>
    >;
    drainHistorySyncPushForPeerRef: MutableRefObject<
        (peerAccount: string) => Promise<void>
    >;
    markDmPendingDeliveredRef: MutableRefObject<
        (clientMsgId: string, recipient: string, spaceId: string) => void
    >;
    flushDebounceRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
    pendingDeliveryCount: number;
    scheduleDmChatDataSession: (
        spaceUuid: string,
        members: readonly string[],
    ) => void;
    scheduleGroupChatDataSession: (
        spaceUuid: string,
        members: readonly string[],
    ) => void;
    openOrFocusDm: (otherAccount: string) => void;
    openGroupChat: (otherAccounts: readonly string[]) => Promise<void>;
    sendChatMessage: (body: string) => void;
};

/** Canonical `[a, b]` DM member pair for a single-recipient pending message. */
export function canonicalDmMembers(
    self: string,
    recipients: readonly string[],
): [string, string] | null {
    if (recipients.length !== 1) return null;
    const peer = recipients[0]!;
    return self.localeCompare(peer) < 0 ? [self, peer] : [peer, self];
}

/**
 * Composition root for chat messaging: inbound message application,
 * pending-message persistence + flush, and outbound send/compose.
 * Deliberately excludes Meet (av-call) state — see `useMeetSession`.
 *
 * This file owns all React state/refs; the actual logic lives as plain
 * factory functions taking an explicit deps bag in
 * `chat-messaging-inbound.ts`, `chat-messaging-pending.ts`, and
 * `chat-messaging-send.ts`, so this file stays focused on wiring.
 */
export function useChatMessaging(
    params: UseChatMessagingParams,
): UseChatMessagingResult {
    const {
        selfRef,
        chainIdRef,
        contactAccountsRef,
        contactsLoadedRef,
        conversationsRef,
        objectiveSpacesRef,
        transportBridgeRef,
        connectionState,
        presenceReady,
        leavingChatRef,
        selectedConversationId,
        selectedConversationIdRef,
        setSelectedConversationId,
        composePendingDmPeer,
        composePendingDmPeerRef,
        setComposePendingDmPeer,
        pendingDmMemberRef,
        resolveConversationSync,
        loadObjectiveSpaces,
        setLastInboundError,
        setUnreadByConversation,
        setTimelineByConversation,
        persistDmHistoryMessage,
        persistGroupHistoryMessage,
        pendingMessagesRef,
        flushPendingMessagesRef,
    } = params;

    const [pendingMessages, setPendingMessages] = useState<
        Record<string, PendingChatMessage>
    >({});
    pendingMessagesRef.current = pendingMessages;

    const [pendingStorageQuotaExceeded, setPendingStorageQuotaExceeded] =
        useState(false);
    const storageFailureRef = useRef<string | null>(null);
    const inFlightDeliveriesRef = useRef<Set<string>>(new Set());
    const pendingGroupKeyRef = useRef<string | null>(null);
    const lastQuotaPromotedRef = useRef<readonly PendingChatMessage[]>([]);

    const upsertPendingTimelineRow = useCallback(
        createUpsertPendingTimelineRow({ setTimelineByConversation }),
        [],
    );
    const upsertPendingTimelineRowRef = useRef(upsertPendingTimelineRow);
    upsertPendingTimelineRowRef.current = upsertPendingTimelineRow;

    const persistPendingMessages = useCallback(
        createPersistPendingMessages({
            selfRef,
            chainIdRef,
            setLastInboundError,
            setPendingStorageQuotaExceeded,
            storageFailureRef,
            lastQuotaPromotedRef,
        }),
        [],
    );

    const drainQuotaPromotions = useCallback(
        createDrainQuotaPromotions({
            lastQuotaPromotedRef,
            pendingMessagesRef,
            setPendingMessages,
            upsertPendingTimelineRowRef,
        }),
        [],
    );

    const replacePendingMessages = useCallback(
        createReplacePendingMessages({
            setPendingMessages,
            pendingMessagesRef,
            persistPendingMessages,
            drainQuotaPromotions,
        }),
        [drainQuotaPromotions, persistPendingMessages],
    );

    const applyInboundChatMessage = useCallback(
        createApplyInboundChatMessage({
            selfRef,
            selectedConversationIdRef,
            composePendingDmPeerRef,
            pendingDmMemberRef,
            setComposePendingDmPeer,
            setSelectedConversationId,
            setUnreadByConversation,
            setTimelineByConversation,
            persistDmHistoryMessage,
        }),
        [
            persistDmHistoryMessage,
            setComposePendingDmPeer,
            setSelectedConversationId,
        ],
    );
    const applyInboundChatMessageRef = useRef(applyInboundChatMessage);
    applyInboundChatMessageRef.current = applyInboundChatMessage;

    const applyInboundDmDataChannelMessage = useCallback(
        createApplyInboundDmDataChannelMessage({
            selfRef,
            contactAccountsRef,
            contactsLoadedRef,
            chainIdRef,
            applyInboundChatMessageRef,
        }),
        [],
    );
    const applyInboundDmDataChannelMessageRef = useRef(
        applyInboundDmDataChannelMessage,
    );
    applyInboundDmDataChannelMessageRef.current =
        applyInboundDmDataChannelMessage;

    const applyInboundGroupDataChannelMessage = useCallback(
        createApplyInboundGroupDataChannelMessage({
            selfRef,
            contactAccountsRef,
            contactsLoadedRef,
            chainIdRef,
            selectedConversationIdRef,
            setUnreadByConversation,
            setTimelineByConversation,
            persistGroupHistoryMessage,
            flushPendingMessagesRef,
        }),
        [persistGroupHistoryMessage],
    );
    const applyInboundGroupDataChannelMessageRef = useRef(
        applyInboundGroupDataChannelMessage,
    );
    applyInboundGroupDataChannelMessageRef.current =
        applyInboundGroupDataChannelMessage;

    const applyInboundDmHistorySync = useCallback(
        createApplyInboundDmHistorySync({
            selfRef,
            conversationsRef,
            contactAccountsRef,
            contactsLoadedRef,
            transportBridgeRef,
            chainIdRef,
            setLastInboundError,
            setTimelineByConversation,
            flushPendingMessagesRef,
        }),
        [],
    );
    const applyInboundDmHistorySyncRef = useRef(applyInboundDmHistorySync);
    applyInboundDmHistorySyncRef.current = applyInboundDmHistorySync;

    const applyInboundGroupHistorySync = useCallback(
        createApplyInboundGroupHistorySync({
            selfRef,
            conversationsRef,
            objectiveSpacesRef,
            transportBridgeRef,
            chainIdRef,
            setLastInboundError,
            setTimelineByConversation,
            flushPendingMessagesRef,
        }),
        [],
    );
    const applyInboundGroupHistorySyncRef = useRef(applyInboundGroupHistorySync);
    applyInboundGroupHistorySyncRef.current = applyInboundGroupHistorySync;

    const pushDmHistorySync = useCallback(
        createPushDmHistorySync({
            selfRef,
            chainIdRef,
            transportBridgeRef,
            setLastInboundError,
        }),
        [],
    );
    const pushDmHistorySyncRef = useRef(pushDmHistorySync);
    pushDmHistorySyncRef.current = pushDmHistorySync;

    const pushGroupHistorySync = useCallback(
        createPushGroupHistorySync({
            selfRef,
            chainIdRef,
            transportBridgeRef,
            setLastInboundError,
        }),
        [],
    );
    const pushGroupHistorySyncRef = useRef(pushGroupHistorySync);
    pushGroupHistorySyncRef.current = pushGroupHistorySync;

    const drainHistorySyncPushForPeer = useCallback(
        createDrainHistorySyncPushForPeer({
            selfRef,
            chainIdRef,
            pushDmHistorySync,
            pushGroupHistorySync,
        }),
        [pushDmHistorySync, pushGroupHistorySync],
    );
    const drainHistorySyncPushForPeerRef = useRef(drainHistorySyncPushForPeer);
    drainHistorySyncPushForPeerRef.current = drainHistorySyncPushForPeer;

    const markDmPendingDelivered = useCallback(
        createMarkDmPendingDelivered({
            selfRef,
            chainIdRef,
            inFlightDeliveriesRef,
            replacePendingMessages,
            upsertPendingTimelineRow,
            setTimelineByConversation,
        }),
        [replacePendingMessages, upsertPendingTimelineRow],
    );
    const markDmPendingDeliveredRef = useRef(markDmPendingDelivered);
    markDmPendingDeliveredRef.current = markDmPendingDelivered;

    const flushPendingMessages = useCallback(
        createFlushPendingMessages({ transportBridgeRef }),
        [],
    );
    flushPendingMessagesRef.current = flushPendingMessages;

    const flushDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const schedulePendingFlush = useCallback(
        createSchedulePendingFlush({ leavingChatRef, flushPendingMessagesRef }),
        [],
    );

    const pendingDeliveryCount = useMemo(
        () =>
            Object.values(pendingMessages).filter(
                (row) => row.status === "pending",
            ).length,
        [pendingMessages],
    );

    // Debounce flush scheduling by one tick (H24) so many effect-driven
    // triggers (pending count change, connection/presence change) coalesce
    // into a single `flushPendingMessages` call.
    useEffect(() => {
        if (pendingDeliveryCount === 0) return;
        if (flushDebounceRef.current != null) {
            clearTimeout(flushDebounceRef.current);
        }
        flushDebounceRef.current = setTimeout(() => {
            flushDebounceRef.current = null;
            schedulePendingFlush();
        }, 80);
        return () => {
            if (flushDebounceRef.current != null) {
                clearTimeout(flushDebounceRef.current);
                flushDebounceRef.current = null;
            }
        };
    }, [schedulePendingFlush, pendingDeliveryCount, connectionState, presenceReady]);

    const scheduleDmChatDataSession = useCallback(
        createScheduleDmChatDataSession({ leavingChatRef, transportBridgeRef }),
        [],
    );

    const scheduleGroupChatDataSession = useCallback(
        createScheduleGroupChatDataSession({ leavingChatRef, transportBridgeRef }),
        [],
    );

    const selectSpaceByMembers = useCallback(
        createSelectSpaceByMembers({
            conversationsRef,
            setSelectedConversationId,
        }),
        [],
    );

    const openOrFocusDm = useCallback(
        createOpenOrFocusDm({
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
        }),
        [loadObjectiveSpaces],
    );

    const openGroupChat = useCallback(
        createOpenGroupChat({
            selfRef,
            pendingGroupKeyRef,
            transportBridgeRef,
            setLastInboundError,
            loadObjectiveSpaces,
            selectSpaceByMembers,
        }),
        [loadObjectiveSpaces, selectSpaceByMembers],
    );

    const enqueueOutboundChatMessage = useCallback(
        createEnqueueOutboundChatMessage({
            leavingChatRef,
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
        }),
        [
            drainQuotaPromotions,
            persistDmHistoryMessage,
            persistGroupHistoryMessage,
            persistPendingMessages,
            scheduleDmChatDataSession,
            scheduleGroupChatDataSession,
            upsertPendingTimelineRow,
        ],
    );

    const sendChatMessage = useCallback(
        createSendChatMessage({
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
        }),
        [
            composePendingDmPeer,
            enqueueOutboundChatMessage,
            loadObjectiveSpaces,
            resolveConversationSync,
            selectedConversationId,
            setSelectedConversationId,
        ],
    );

    return {
        pendingMessages,
        setPendingMessages,
        pendingStorageQuotaExceeded,
        storageFailureRef,
        upsertPendingTimelineRow,
        applyInboundChatMessage,
        applyInboundDmDataChannelMessageRef,
        applyInboundGroupDataChannelMessageRef,
        applyInboundDmHistorySyncRef,
        applyInboundGroupHistorySyncRef,
        pushDmHistorySyncRef,
        pushGroupHistorySyncRef,
        drainHistorySyncPushForPeerRef,
        markDmPendingDeliveredRef,
        flushDebounceRef,
        pendingDeliveryCount,
        scheduleDmChatDataSession,
        scheduleGroupChatDataSession,
        openOrFocusDm,
        openGroupChat,
        sendChatMessage,
    };
}
