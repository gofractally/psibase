import type {
    ChatTimelineCallEventRow,
    ChatTimelineMessageRow,
    ChatTimelineRow,
    ChatUiMessage,
    PresenceUi,
} from "../lib/chat-timeline-types";
import type { ConversationSnapshot, IceServerConfig } from "../lib/protocol";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useWebRtcSession } from "@shared/domains/webrtc";
import { useChainId } from "@shared/hooks/use-chain-id";
import { useContacts } from "@shared/hooks/use-contacts";
import { useCurrentUser } from "@shared/hooks/use-current-user";

import type { AvCallSessionOrchestrator } from "../lib/av-call-session-orchestrator";

import { shortSpaceId } from "../lib/chat-data-debug";
import { pendingRecipientCount } from "../lib/chat-timeline-types";
import { recordChurnTrace } from "../lib/churn-trace";
import { conversationVisibleToUser } from "../lib/contacts-policy";
import { composeTimingLog } from "../lib/dm-compose-timing";
import { dmComposerDisabledReason } from "../lib/dm-compose-ux";
import { resolveVisibleConversation } from "../lib/dm-contacts-meet-flow";
import {
    findDmConversationWithPeer,
    resolveComposeSurfaceConversationId,
} from "../lib/dm-first-message-send";
import type { PendingChatMessage } from "../lib/pending-message-store";
import { RealtimeClient } from "../lib/realtime-client";
import {
    type GraphqlSpaceEntry,
    conversationIdFromSpaceUuid,
    spaceEntryToConversation,
    spaceUuidFromConversationId,
} from "../lib/space-bridge";
import {
    peerStatesForRemotes,
    recordThreadLifecycle,
    threadLifecycleSnapshot,
} from "../lib/thread-lifecycle";
import { ChatTransportBridge } from "../transport/chat-transport-bridge";
import type {
    ActiveCall,
    IncomingCall,
    UseChatSocketOptions,
} from "./chat/chat-socket-types";
import { useChatHistory } from "./chat/use-chat-history";
import { useChatMessaging } from "./chat/use-chat-messaging";
import { useChatTransportLifecycle } from "./chat/use-chat-transport-lifecycle";
import { useConversationSelection } from "./chat/use-conversation-selection";
import { useMeetSession } from "./chat/use-meet-session";
import { useObjectiveSpaces } from "./chat/use-objective-spaces";

export type {
    ChatMessageStatus,
    ChatTimelineCallEventRow,
    ChatTimelineMessageRow,
    ChatTimelineRow,
    ChatUiMessage,
    PresenceUi,
} from "../lib/chat-timeline-types";
export type { ActiveCall, IncomingCall, UseChatSocketOptions } from "./chat/chat-socket-types";

/** Chat UI state: objective Spaces (GraphQL) + x-wrtcsig presence/realtime; DMs use the data channel. */
export function useChatSocket(options?: UseChatSocketOptions) {
    const {
        client: webrtcClient,
        connectionState,
        registerHandlers,
        reconnectNow: reconnectWebRtcSession,
        iceServers: sessionIceServers,
    } = useWebRtcSession();

    const { data: chainId = "" } = useChainId();
    const chainIdRef = useRef(chainId);
    chainIdRef.current = chainId;

    const { data: currentUser } = useCurrentUser();
    const { data: contactsData, isSuccess: contactsLoaded } =
        useContacts(currentUser);

    const contactAccounts = useMemo(
        () => new Set(contactsData?.map((c) => c.account) ?? []),
        [contactsData],
    );
    const contactAccountsRef = useRef(contactAccounts);
    contactAccountsRef.current = contactAccounts;
    const contactsLoadedRef = useRef(contactsLoaded);
    contactsLoadedRef.current = contactsLoaded;

    const selfRef = useRef<string | null>(null);

    const [selfAccount, setSelfAccount] = useState<string | null>(null);

    useEffect(() => {
        if (!currentUser) return;
        if (selfRef.current) return;
        selfRef.current = currentUser;
        setSelfAccount(currentUser);
    }, [currentUser]);

    const [lastRealtimeError, setLastRealtimeError] = useState<string | null>(
        null,
    );
    /** True after first `presenceSnapshot` on x-wrtcsig. */
    const [presenceReady, setPresenceReady] = useState(false);
    const presenceReadyRef = useRef(false);

    const [presenceByAccount, setPresenceByAccount] = useState<
        Record<string, PresenceUi>
    >({});
    const presenceByAccountRef = useRef(presenceByAccount);
    presenceByAccountRef.current = presenceByAccount;

    /** Update ref before React re-render so orchestrator sees fresh presence in the same tick. */
    const patchPresenceRef = useCallback(
        (account: string, status: PresenceUi) => {
            if (presenceByAccountRef.current[account] === status) return;
            presenceByAccountRef.current = {
                ...presenceByAccountRef.current,
                [account]: status,
            };
        },
        [],
    );

    const {
        objectiveSpaces,
        spacesLoadError,
        objectiveSpacesRef,
        loadObjectiveSpaces,
        loadObjectiveSpacesRef,
        scheduleSpacesReloadOnPresenceOnline,
    } = useObjectiveSpaces(selfAccount);

    const reloadSpacesIfMissing = useCallback((spaceUuid: string) => {
        const self = selfRef.current;
        if (!self) return;
        const known = resolveVisibleConversation(
            spaceUuid,
            self,
            objectiveSpacesRef.current,
            contactAccountsRef.current,
            contactsLoadedRef.current,
        );
        if (!known) {
            void loadObjectiveSpacesRef.current();
        }
    }, []);

    const [timelineByConversation, setTimelineByConversation] = useState<
        Record<string, ChatTimelineRow[]>
    >({});
    const [unreadByConversation, setUnreadByConversation] = useState<
        Record<string, number>
    >({});

    const iceServersRef = useRef<IceServerConfig[] | null>(null);

    const [lastInboundError, setLastInboundError] = useState<string | null>(
        null,
    );

    const realtimeClientRef = useRef<RealtimeClient | null>(null);
    useEffect(() => {
        realtimeClientRef.current = webrtcClient;
    }, [webrtcClient]);

    useEffect(() => {
        iceServersRef.current =
            sessionIceServers.length > 0 ? [...sessionIceServers] : null;
    }, [sessionIceServers]);

    useEffect(() => {
        if (connectionState === "offline") {
            presenceReadyRef.current = false;
            setPresenceReady(false);
        }
    }, [connectionState]);

    const transportBridgeRef = useRef<ChatTransportBridge | null>(null);
    const avCallOrchestratorRef = useRef<AvCallSessionOrchestrator | null>(
        null,
    );
    /** True while tearing down or navigating away from Chat (blocks new ensures). */
    const leavingChatRef = useRef(false);
    /** Previous effect tick was on a chat route (detect enter vs still-on-chat). */
    const wasOnChatRouteRef = useRef(false);

    const conversationIdsRef = useRef<string[]>([]);
    const pendingMessagesRef = useRef<Record<string, PendingChatMessage>>({});
    const flushPendingMessagesRef = useRef<() => void>(() => {});

    objectiveSpacesRef.current = objectiveSpaces;

    const conversations = useMemo(() => {
        const self = selfAccount;
        if (!self) return [];
        return objectiveSpaces
            .map(spaceEntryToConversation)
            .filter((conv) =>
                conversationVisibleToUser(
                    conv,
                    self,
                    contactAccounts,
                    contactsLoaded,
                ),
            );
    }, [objectiveSpaces, selfAccount, contactAccounts, contactsLoaded]);

    const {
        selectedConversationId,
        setSelectedConversationId,
        selectConversation,
        composePendingDmPeer,
        setComposePendingDmPeer,
        selectedConversationIdRef,
        composePendingDmPeerRef,
        pendingDmMemberRef,
    } = useConversationSelection({
        chainId,
        urlConversationId: options?.urlConversationId,
        selfAccount,
        contactsLoaded,
        conversations,
        objectiveSpacesCount: objectiveSpaces.length,
        spacesLoadError,
    });

    const conversationsRef = useRef<ConversationSnapshot[]>([]);
    conversationsRef.current = conversations;

    const resolveConversationSync = useCallback(
        (spaceUuid: string): ConversationSnapshot | undefined => {
            const self = selfRef.current;
            if (!self) return undefined;
            return resolveVisibleConversation(
                spaceUuid,
                self,
                objectiveSpacesRef.current,
                contactAccountsRef.current,
                contactsLoadedRef.current,
            );
        },
        [],
    );

    const conversationIdsForSpaces = useCallback(
        (spaces: GraphqlSpaceEntry[]) => {
            return spaces.map((space) =>
                conversationIdFromSpaceUuid(space.space_uuid),
            );
        },
        [],
    );

    useEffect(() => {
        const self = selfAccount;
        const visible = self
            ? objectiveSpaces.filter((entry) =>
                  conversationVisibleToUser(
                      spaceEntryToConversation(entry),
                      self,
                      contactAccounts,
                      contactsLoaded,
                  ),
              )
            : [];
        conversationIdsRef.current = conversationIdsForSpaces(visible);
    }, [
        objectiveSpaces,
        selfAccount,
        contactAccounts,
        contactsLoaded,
        conversationIdsForSpaces,
    ]);

    const syncKnownConversations = useCallback(() => {
        /* Objective spaces load via GraphQL; x-webrtc-sig has no conversation sync. */
    }, []);

    const {
        persistDmHistoryMessage,
        persistGroupHistoryMessage,
        restoreDmHistoryFromStore,
        restoreGroupHistoryFromStore,
        refreshObjectiveCallEventsForSpaceRef,
        restoreObjectiveCallEvents,
    } = useChatHistory({
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
    });

    const {
        pendingMessages,
        setPendingMessages,
        pendingStorageQuotaExceeded,
        storageFailureRef,
        upsertPendingTimelineRow,
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
    } = useChatMessaging({
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
    });

    const {
        incomingCall,
        activeCall,
        activeCallRef,
        incomingAvCallInvite,
        setIncomingAvCallInvite,
        groupMeetRejoinHint,
        groupMeetLifecycleRef,
        ringOutTimerRef,
        terminalCallDismissTimerRef,
        markSignalingTeardown,
        syncAvCallUiRef,
        onAvCallMediaReadyRef,
        onAvCallParticipantStateRef,
        startMeetCall,
        startMockCall,
        acceptIncomingCall,
        declineIncomingCall,
        rejoinGroupMeetCall,
        endPlaceholderCall,
        requestVoluntaryMeetLeave,
        callLocalStream: uiCallLocalStream,
        callRemoteStream: uiCallRemoteStream,
        callRemoteStreamsByAccount: uiCallRemoteStreamsByAccount,
        callAudioMuted: uiCallAudioMuted,
        callVideoMuted: uiCallVideoMuted,
        callRemoteAudioMuted: uiCallRemoteAudioMuted,
        callRemoteVideoMuted: uiCallRemoteVideoMuted,
        callRemoteAvStateByAccount: uiCallRemoteAvStateByAccount,
        callAudioOnlyFallback: uiCallAudioOnlyFallback,
        toggleCallAudioMuted: uiToggleCallAudioMuted,
        toggleCallVideoMuted: uiToggleCallVideoMuted,
    } = useMeetSession({
        selfRef,
        avCallOrchestratorRef,
        conversationsRef,
        objectiveSpacesRef,
        contactAccountsRef,
        contactsLoadedRef,
        presenceByAccountRef,
        selectedConversationId,
        setSelectedConversationId,
        composePendingDmPeerRef,
        setComposePendingDmPeer,
        pendingDmMemberRef,
        resolveConversationSync,
        loadObjectiveSpaces,
        setLastInboundError,
        refreshObjectiveCallEventsForSpaceRef,
    });

    const {
        onChatRoute,
        location,
        suspendChatNavigation,
        dropChatTransportForNavigation,
        reconnectNow,
        churnLagRef,
    } = useChatTransportLifecycle({
        webrtcClient,
        registerHandlers,
        connectionState,
        reconnectWebRtcSession,
        chainId,
        chainIdRef,
        selfAccount,
        selfRef,
        contactsLoaded,
        contactAccountsRef,
        contactsLoadedRef,
        presenceByAccountRef,
        setPresenceReady,
        presenceReadyRef,
        setPresenceByAccount,
        patchPresenceRef,
        setSelfAccount,
        setLastRealtimeError,
        setLastInboundError,
        objectiveSpacesRef,
        loadObjectiveSpacesRef,
        scheduleSpacesReloadOnPresenceOnline,
        conversationsRef,
        conversations,
        selectedConversationId,
        selectedConversationIdRef,
        setSelectedConversationId,
        pendingDmMemberRef,
        transportBridgeRef,
        avCallOrchestratorRef,
        leavingChatRef,
        wasOnChatRouteRef,
        iceServersRef,
        realtimeClientRef,
        reloadSpacesIfMissing,
        syncKnownConversations,
        restoreDmHistoryFromStore,
        restoreGroupHistoryFromStore,
        restoreObjectiveCallEvents,
        pendingMessagesRef,
        setPendingMessages,
        upsertPendingTimelineRow,
        storageFailureRef,
        flushPendingMessagesRef,
        flushDebounceRef,
        applyInboundDmDataChannelMessageRef,
        applyInboundGroupDataChannelMessageRef,
        applyInboundDmHistorySyncRef,
        applyInboundGroupHistorySyncRef,
        pushDmHistorySyncRef,
        pushGroupHistorySyncRef,
        drainHistorySyncPushForPeerRef,
        markDmPendingDeliveredRef,
        scheduleDmChatDataSession,
        scheduleGroupChatDataSession,
        setIncomingAvCallInvite,
        activeCallRef,
        groupMeetLifecycleRef,
        ringOutTimerRef,
        terminalCallDismissTimerRef,
        markSignalingTeardown,
        syncAvCallUiRef,
        onAvCallMediaReadyRef,
        onAvCallParticipantStateRef,
        pendingDeliveryCount,
    });

    const authLost = useMemo(() => {
        const e = lastRealtimeError ?? "";
        return (
            /\b401\b/.test(e) ||
            e.toLowerCase().includes("unauthorized") ||
            e.toLowerCase().includes("/login failed")
        );
    }, [lastRealtimeError]);

    const chatTransportReady = connectionState === "connected" && presenceReady;

    const composeSurfaceConversationId = useMemo(
        () =>
            resolveComposeSurfaceConversationId(
                selectedConversationId,
                composePendingDmPeer,
                selfAccount,
                conversations,
            ),
        [
            composePendingDmPeer,
            conversations,
            selectedConversationId,
            selfAccount,
        ],
    );

    const selectedTimeline = useMemo(() => {
        if (!composeSurfaceConversationId) return [];
        return timelineByConversation[composeSurfaceConversationId] ?? [];
    }, [composeSurfaceConversationId, timelineByConversation]);

    useEffect(() => {
        const pendingPeer = composePendingDmPeer;
        const self = selfAccount;
        if (!pendingPeer || !self) return;
        if (pendingDmMemberRef.current === pendingPeer) return;

        const dm = findDmConversationWithPeer(conversations, self, pendingPeer);
        if (!dm) return;

        pendingDmMemberRef.current = null;
        setComposePendingDmPeer(null);
        if (selectedConversationId !== dm.conversationId) {
            setSelectedConversationId(
                dm.conversationId,
                "pending-peer-space-ready",
            );
        }
    }, [
        composePendingDmPeer,
        conversations,
        selectedConversationId,
        selfAccount,
        setComposePendingDmPeer,
        setSelectedConversationId,
    ]);

    useEffect(() => {
        if (!composeSurfaceConversationId) return;
        setUnreadByConversation((prev) => {
            if (!prev[composeSurfaceConversationId]) return prev;
            const next = { ...prev };
            delete next[composeSurfaceConversationId];
            return next;
        });
    }, [composeSurfaceConversationId, selectedTimeline.length]);

    const selectedConversation = useMemo(
        () =>
            conversations.find(
                (c) => c.conversationId === selectedConversationId,
            ),
        [conversations, selectedConversationId],
    );

    const isDmComposeSurface =
        selectedConversation?.kind === "dm" || !!composePendingDmPeer;
    const isGroupComposeSurface = selectedConversation?.kind === "group";

    const composerDisabledReason = useMemo((): string | null => {
        if (isDmComposeSurface || isGroupComposeSurface) {
            return dmComposerDisabledReason({
                spacesLoadError,
                authLost,
                selfAccount,
                selectedConversationId,
                pendingDmPeerAccount: composePendingDmPeer,
            });
        }
        if (spacesLoadError)
            return `Could not load chat spaces: ${spacesLoadError}`;
        if (authLost)
            return "Session expired — refresh the page to sign in again.";
        if (connectionState === "offline") return "Disconnected.";
        if (connectionState === "reconnecting") return "Reconnecting…";
        if (!chatTransportReady) return "Waiting for sync…";
        if (!selectedConversationId) return "Select or start a conversation.";
        return null;
    }, [
        authLost,
        chatTransportReady,
        composePendingDmPeer,
        connectionState,
        isDmComposeSurface,
        isGroupComposeSurface,
        selectedConversation,
        selectedConversationId,
        selfAccount,
        spacesLoadError,
    ]);

    const threadRemoteRecipients = useMemo(() => {
        const self = selfAccount;
        if (!self) return [];
        if (composePendingDmPeer) return [composePendingDmPeer];
        if (!selectedConversation) return [];
        return selectedConversation.members.filter((member) => member !== self);
    }, [composePendingDmPeer, selectedConversation, selfAccount]);

    const [threadPeersUsable, setThreadPeersUsable] = useState(false);
    const prevPeerStatesRef = useRef<Map<string, string>>(new Map());
    const prevEstablishingRef = useRef(false);
    const prevPeersUsableRef = useRef(false);

    useEffect(() => {
        if (threadRemoteRecipients.length === 0) {
            setThreadPeersUsable(false);
            prevPeerStatesRef.current.clear();
            return;
        }
        const readPeerUsability = () => {
            const fabric = transportBridgeRef.current?.deliveryFabric;
            if (!fabric) {
                setThreadPeersUsable(false);
                return;
            }
            const rows = peerStatesForRemotes(
                threadRemoteRecipients,
                (remote) => fabric.getPeerState(remote),
            );
            for (const row of rows) {
                const prev = prevPeerStatesRef.current.get(row.remote);
                if (prev !== row.state) {
                    prevPeerStatesRef.current.set(row.remote, row.state);
                    recordThreadLifecycle("peer-state", {
                        remote: row.remote,
                        state: row.state,
                        prev: prev ?? null,
                    });
                }
            }
            setThreadPeersUsable(rows.every((row) => row.state === "usable"));
        };
        readPeerUsability();
        const id = window.setInterval(readPeerUsability, 400);
        return () => window.clearInterval(id);
    }, [threadRemoteRecipients]);

    const threadEstablishingConnection =
        (isDmComposeSurface || isGroupComposeSurface) &&
        composerDisabledReason === null &&
        connectionState === "connected" &&
        presenceReady &&
        threadRemoteRecipients.length > 0 &&
        !threadPeersUsable;

    useEffect(() => {
        const establishing = threadEstablishingConnection;
        const was = prevEstablishingRef.current;
        if (establishing && !was) {
            const fabric = transportBridgeRef.current?.deliveryFabric;
            recordThreadLifecycle("establishing-start", {
                recipients: threadRemoteRecipients,
                peerStates: fabric
                    ? peerStatesForRemotes(threadRemoteRecipients, (remote) =>
                          fabric.getPeerState(remote),
                      )
                    : [],
            });
        } else if (!establishing && was) {
            recordThreadLifecycle("establishing-end", {
                threadPeersUsable,
                recipients: threadRemoteRecipients,
            });
        }
        prevEstablishingRef.current = establishing;
    }, [
        threadEstablishingConnection,
        threadPeersUsable,
        threadRemoteRecipients,
    ]);

    useEffect(() => {
        if (threadPeersUsable && !prevPeersUsableRef.current) {
            const fabric = transportBridgeRef.current?.deliveryFabric;
            recordThreadLifecycle("mesh-live", {
                recipients: threadRemoteRecipients,
                peerStates: fabric
                    ? peerStatesForRemotes(threadRemoteRecipients, (remote) =>
                          fabric.getPeerState(remote),
                      )
                    : [],
            });
        }
        prevPeersUsableRef.current = threadPeersUsable;
    }, [threadPeersUsable, threadRemoteRecipients]);

    const composeSurfaceFocusKey =
        composePendingDmPeer ?? selectedConversationId ?? "no-thread";

    useEffect(() => {
        if (composerDisabledReason !== null) return;
        composeTimingLog("composer-enabled", {
            selectedConversationId: selectedConversationId
                ? shortSpaceId(selectedConversationId)
                : undefined,
            composePendingDmPeer,
            hasConversationRow: !!selectedConversation,
        });
        recordThreadLifecycle("composer-ready", {
            selectedSpaceId: selectedConversationId
                ? shortSpaceId(selectedConversationId)
                : null,
            composePendingDmPeer,
            kind: selectedConversation?.kind ?? null,
            threadPeersUsable,
        });
    }, [
        composerDisabledReason,
        composePendingDmPeer,
        selectedConversation,
        selectedConversationId,
        threadPeersUsable,
    ]);

    const undeliveredByConversation = useMemo(() => {
        const counts: Record<string, number> = {};
        for (const pending of Object.values(pendingMessages)) {
            const count = pendingRecipientCount(pending);
            if (count <= 0) continue;
            const spaceId = spaceUuidFromConversationId(
                pending.conversationId,
            );
            counts[spaceId] = (counts[spaceId] ?? 0) + count;
        }
        return counts;
    }, [pendingMessages]);

    const selectedHasPendingMessages =
        !!selectedConversationId &&
        (undeliveredByConversation[selectedConversationId] ?? 0) > 0;

    const incomingCallForDialog = useMemo((): IncomingCall | null => {
        if (incomingCall) return incomingCall;
        if (!incomingAvCallInvite || !selfAccount) return null;
        const active = activeCallRef.current;
        if (
            active?.source === "av-call" &&
            active.conversationId === incomingAvCallInvite.spaceUuid
        ) {
            return null;
        }
        const participantCount = incomingAvCallInvite.participants?.length ?? 0;
        return {
            callId: incomingAvCallInvite.sessionId,
            conversationId: incomingAvCallInvite.spaceUuid,
            from: incomingAvCallInvite.from,
            to: selfAccount,
            wantVideo: incomingAvCallInvite.wantVideo,
            wantAudio: incomingAvCallInvite.wantAudio,
            serverTime: Date.now(),
            source: "av-call",
            groupParticipantCount:
                participantCount > 2 ? participantCount : undefined,
        };
    }, [incomingCall, incomingAvCallInvite, selfAccount, activeCall]);

    useEffect(() => {
        if (typeof window === "undefined") return;
        const w = window as Window & {
            __chatChurnTeardown?: () => void;
            __chatChurnSuspend?: () => void;
            __chatChurnOpenDm?: (peerAccount: string) => void;
            __chatChurnState?: () => Record<string, unknown>;
        };
        w.__chatChurnTeardown = dropChatTransportForNavigation;
        w.__chatChurnSuspend = suspendChatNavigation;
        w.__chatChurnOpenDm = (peerAccount: string) => {
            recordChurnTrace("open-dm-debug", { peer: peerAccount });
            openOrFocusDm(peerAccount);
        };
        const snapshotChurnState = () => {
            const selected = selectedConversationId ?? null;
            const listed = selected
                ? conversationsRef.current.find(
                      (row) => row.conversationId === selected,
                  )
                : undefined;
            const resolved =
                listed ??
                (selected ? resolveConversationSync(selected) : undefined);
            const fabric = transportBridgeRef.current?.deliveryFabric;
            const peerStates = fabric
                ? peerStatesForRemotes(threadRemoteRecipients, (remote) =>
                      fabric.getPeerState(remote),
                  )
                : [];
            const thread = threadLifecycleSnapshot({
                selectedConversationId: selected,
                composePendingDmPeer: composePendingDmPeerRef.current,
                conversationKind: resolved?.kind ?? null,
                composerDisabledReason,
                threadEstablishingConnection,
                threadPeersUsable,
                threadRemoteRecipients,
                connectionState,
                presenceReady,
                peerStates,
            });
            return {
                leavingChat: leavingChatRef.current,
                wasOnChatRoute: wasOnChatRouteRef.current,
                onChatRoute,
                pathname: location.pathname,
                selfAccount,
                selectedConversationId: selected,
                composePendingDmPeer: composePendingDmPeerRef.current,
                pendingDmMember: pendingDmMemberRef.current,
                selectedConversationKind: resolved?.kind ?? null,
                selectedMemberCount: resolved?.members.length ?? null,
                conversationListSummary: {
                    total: conversationsRef.current.length,
                    dm: conversationsRef.current.filter((c) => c.kind === "dm")
                        .length,
                    group: conversationsRef.current.filter(
                        (c) => c.kind === "group",
                    ).length,
                    objectiveSpacesCount: objectiveSpacesRef.current.length,
                },
                hasTransportBridge: Boolean(transportBridgeRef.current),
                hasAvOrchestrator: Boolean(avCallOrchestratorRef.current),
                navigationSuspended:
                    transportBridgeRef.current?.isNavigationSuspended() ??
                    false,
                realtimeState: realtimeClientRef.current?.state ?? null,
                realtimeReady:
                    realtimeClientRef.current?.isSessionReady ?? null,
                realtimeLastError: realtimeClientRef.current?.lastError ?? null,
                eventLoopLag: churnLagRef.current,
                thread,
            };
        };
        w.__chatChurnState = snapshotChurnState;
        w.__chatChurnProbe = () => ({
            at: Date.now(),
            href: window.location.href,
            state: snapshotChurnState(),
            traceTail: window.__chatChurnTrace?.events?.().slice(-20) ?? [],
            threadLifecycleTail:
                window.__chatThreadLifecycle?.events?.().slice(-24) ?? [],
        });
        return () => {
            delete w.__chatChurnTeardown;
            delete w.__chatChurnSuspend;
            delete w.__chatChurnOpenDm;
            delete w.__chatChurnState;
            delete w.__chatChurnProbe;
        };
    }, [
        dropChatTransportForNavigation,
        suspendChatNavigation,
        openOrFocusDm,
        onChatRoute,
        location.pathname,
        selfAccount,
        selectedConversationId,
        composerDisabledReason,
        threadEstablishingConnection,
        threadPeersUsable,
        threadRemoteRecipients,
        connectionState,
        presenceReady,
    ]);

    return {
        connectionState,
        lastRealtimeError,
        presenceReady,
        lastInboundError: spacesLoadError ?? lastInboundError,
        pendingStorageQuotaExceeded,
        authLost,
        reconnectNow,

        selfAccount,
        presenceByAccount,
        conversations,
        selectedConversationId,
        setSelectedConversationId,
        selectConversation,
        composePendingDmPeer,
        selectedConversation,
        selectedTimeline,
        unreadByConversation,
        undeliveredByConversation,
        selectedHasPendingMessages,

        openOrFocusDm,
        openGroupChat,
        sendChatMessage,
        incomingCall: incomingCallForDialog,
        activeCall,
        startMeetCall,
        startMockCall,
        acceptIncomingCall,
        declineIncomingCall,
        endPlaceholderCall,
        requestVoluntaryMeetLeave,
        groupMeetRejoinHint,
        rejoinGroupMeetCall,

        callLocalStream: uiCallLocalStream,
        callRemoteStream: uiCallRemoteStream,
        callRemoteStreamsByAccount: uiCallRemoteStreamsByAccount,
        callAudioMuted: uiCallAudioMuted,
        callVideoMuted: uiCallVideoMuted,
        callRemoteAudioMuted: uiCallRemoteAudioMuted,
        callRemoteVideoMuted: uiCallRemoteVideoMuted,
        callRemoteAvStateByAccount: uiCallRemoteAvStateByAccount,
        callAudioOnlyFallback: uiCallAudioOnlyFallback,
        toggleCallAudioMuted: uiToggleCallAudioMuted,
        toggleCallVideoMuted: uiToggleCallVideoMuted,

        chatTransportReady,
        composerDisabledReason,
        threadEstablishingConnection,
        composeSurfaceFocusKey,
    };
}
