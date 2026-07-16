import { type MutableRefObject, useCallback, useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";

import type {
    ChatDataMessageEnvelope,
    ChatHistorySyncEnvelope,
} from "../../lib/chat-data-envelope";
import type { PresenceUi } from "../../lib/chat-timeline-types";
import type { InboundMessageAcceptance } from "../../lib/inbound-message-acceptance";
import type { PendingChatMessage } from "../../lib/pending-message-store";
import type { ConversationSnapshot, IceServerConfig } from "../../lib/protocol";
import type { RealtimeClient } from "../../lib/realtime-client";
import type { GraphqlSpaceEntry } from "../../lib/space-bridge";
import type { ActiveCall } from "./chat-socket-types";

import {
    type AvCallIncomingInvite,
    AvCallSessionOrchestrator,
    type AvCallSessionSnapshot,
} from "../../lib/av-call-session-orchestrator";
import { fetchSpaceCallEvents } from "../../lib/chat-api";
import {
    chatDataLog,
    installChatDataDebugGlobal,
    shortSpaceId,
} from "../../lib/chat-data-debug";
import { recordChurnTrace } from "../../lib/churn-trace";
import { composeTimingLog } from "../../lib/dm-compose-timing";
import {
    needsSpaceReloadForAvCallInvite,
    resolveVisibleConversation,
    shouldAcceptAvCallInvite,
} from "../../lib/dm-contacts-meet-flow";
import { isInboundContactPeer } from "../../lib/contacts-policy";
import { shouldAcceptGroupAvCallInvite } from "../../lib/group-contacts-meet-flow";
import { isGroupHistorySyncSpace } from "../../lib/group-history-sync";
import { isGroupMeetLeaveInProgress } from "../../lib/group-meet-lifecycle-ui";
import type { GroupMeetLifecycleBySpace } from "../../lib/group-meet-lifecycle-ui";
import { loadPendingMessages } from "../../lib/pending-message-store";
import { spaceUuidFromConversationId } from "../../lib/space-bridge";
import { installThreadLifecycleGlobal } from "../../lib/thread-lifecycle";
import { ChatTransportBridge } from "../../transport/chat-transport-bridge";
import { createChatTransportBridge } from "./use-chat-orchestrator";
import { canonicalDmMembers } from "./use-chat-messaging";

export type UseChatTransportLifecycleParams = {
    webrtcClient: RealtimeClient | null;
    registerHandlers: (handlers: Record<string, unknown>) => () => void;
    connectionState: string;
    reconnectWebRtcSession: () => void;
    chainId: string;
    chainIdRef: MutableRefObject<string>;
    selfAccount: string | null;
    selfRef: MutableRefObject<string | null>;
    contactsLoaded: boolean;
    contactAccountsRef: MutableRefObject<Set<string>>;
    contactsLoadedRef: MutableRefObject<boolean>;
    presenceByAccountRef: MutableRefObject<Record<string, PresenceUi>>;
    setPresenceReady: (value: boolean) => void;
    presenceReadyRef: MutableRefObject<boolean>;
    setPresenceByAccount: React.Dispatch<
        React.SetStateAction<Record<string, PresenceUi>>
    >;
    patchPresenceRef: (account: string, status: PresenceUi) => void;
    setSelfAccount: (account: string) => void;
    setLastRealtimeError: (value: string | null) => void;
    setLastInboundError: (value: string | null) => void;
    objectiveSpacesRef: MutableRefObject<GraphqlSpaceEntry[]>;
    loadObjectiveSpacesRef: MutableRefObject<
        () => Promise<GraphqlSpaceEntry[]>
    >;
    scheduleSpacesReloadOnPresenceOnline: () => void;
    conversationsRef: MutableRefObject<ConversationSnapshot[]>;
    conversations: ConversationSnapshot[];
    selectedConversationId: string | undefined;
    selectedConversationIdRef: MutableRefObject<string | undefined>;
    setSelectedConversationId: (
        id: string | undefined,
        source?: string,
    ) => void;
    pendingDmMemberRef: MutableRefObject<string | null>;
    transportBridgeRef: MutableRefObject<ChatTransportBridge | null>;
    avCallOrchestratorRef: MutableRefObject<AvCallSessionOrchestrator | null>;
    leavingChatRef: MutableRefObject<boolean>;
    wasOnChatRouteRef: MutableRefObject<boolean>;
    iceServersRef: MutableRefObject<IceServerConfig[] | null>;
    realtimeClientRef: MutableRefObject<RealtimeClient | null>;
    reloadSpacesIfMissing: (spaceUuid: string) => void;
    syncKnownConversations: () => void;
    restoreDmHistoryFromStore: (account: string) => Promise<void>;
    restoreGroupHistoryFromStore: (account: string) => Promise<void>;
    restoreObjectiveCallEvents: () => Promise<void>;
    pendingMessagesRef: MutableRefObject<Record<string, PendingChatMessage>>;
    setPendingMessages: React.Dispatch<
        React.SetStateAction<Record<string, PendingChatMessage>>
    >;
    upsertPendingTimelineRow: (pending: PendingChatMessage) => void;
    storageFailureRef: MutableRefObject<string | null>;
    flushPendingMessagesRef: MutableRefObject<() => void>;
    flushDebounceRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
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
    scheduleDmChatDataSession: (
        spaceUuid: string,
        members: readonly string[],
    ) => void;
    scheduleGroupChatDataSession: (
        spaceUuid: string,
        members: readonly string[],
    ) => void;
    setIncomingAvCallInvite: (invite: AvCallIncomingInvite | null) => void;
    activeCallRef: MutableRefObject<ActiveCall | null>;
    groupMeetLifecycleRef: MutableRefObject<GroupMeetLifecycleBySpace>;
    ringOutTimerRef: MutableRefObject<ReturnType<
        typeof globalThis.setTimeout
    > | null>;
    terminalCallDismissTimerRef: MutableRefObject<ReturnType<
        typeof globalThis.setTimeout
    > | null>;
    markSignalingTeardown: (callId: string | undefined) => void;
    syncAvCallUiRef: MutableRefObject<
        (spaceUuid: string, snap: AvCallSessionSnapshot) => void
    >;
    onAvCallMediaReadyRef: MutableRefObject<
        (
            spaceUuid: string,
            info: {
                peerAccount: string;
                localStream: MediaStream;
                remoteStream: MediaStream | null;
            },
        ) => void
    >;
    onAvCallParticipantStateRef: MutableRefObject<
        (
            sessionId: string,
            participant: string,
            state: { audioMuted?: boolean; videoMuted?: boolean },
        ) => void
    >;
    pendingDeliveryCount: number;
};

export type UseChatTransportLifecycleResult = {
    onChatRoute: boolean;
    location: ReturnType<typeof useLocation>;
    suspendChatNavigation: () => void;
    dropChatTransportForNavigation: () => void;
    reconnectNow: () => void;
    churnLagRef: MutableRefObject<{
        lastTickAt: number;
        maxLagMs: number;
        lastLagMs: number;
    }>;
};

function shouldAcceptInboundFromFactory(
    selfRef: MutableRefObject<string | null>,
    contactAccountsRef: MutableRefObject<Set<string>>,
    contactsLoadedRef: MutableRefObject<boolean>,
) {
    return (account: string): boolean =>
        isInboundContactPeer(
            selfRef.current,
            account,
            contactAccountsRef.current,
            contactsLoadedRef.current,
        );
}

/**
 * Realtime transport lifecycle: constructs the `ChatTransportBridge` +
 * `AvCallSessionOrchestrator`, registers websocket handlers, ensures chat
 * data sessions for the active selection, and manages navigation
 * suspend/drop/teardown.
 */
export function useChatTransportLifecycle(
    params: UseChatTransportLifecycleParams,
): UseChatTransportLifecycleResult {
    const {
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
    } = params;

    const shouldAcceptInboundFrom = shouldAcceptInboundFromFactory(
        selfRef,
        contactAccountsRef,
        contactsLoadedRef,
    );

    const discoverActiveGroupAvCallInviteRef = useRef(
        async (_spaceUuid: string, _members: readonly string[]) => {},
    );

    useEffect(() => {
        if (!contactsLoaded || !selfAccount) return;
        transportBridgeRef.current?.flushDeferredInboundAcceptance((record) => {
            const envelope: ChatDataMessageEnvelope = {
                t: "chatMessage",
                spaceUuid: record.spaceUuid,
                from: record.from,
                body: record.body,
                sendTimestamp: record.sendTimestamp,
                clientMsgId: record.clientMsgId,
            };
            const conversation = conversationsRef.current.find(
                (row) => row.conversationId === record.spaceUuid,
            );
            if (conversation?.kind === "group") {
                return applyInboundGroupDataChannelMessageRef.current(envelope);
            }
            return applyInboundDmDataChannelMessageRef.current(envelope);
        });
        globalThis.setTimeout(() => flushPendingMessagesRef.current(), 0);
    }, [contactsLoaded, selfAccount]);

    useEffect(() => {
        if (!webrtcClient) return;

        const unregisterHandlers = registerHandlers({
            welcome: (frame: {
                user: string;
                iceServers: IceServerConfig[];
            }) => {
                recordChurnTrace("ws-welcome", {
                    user: frame.user,
                    selectedConversationId: selectedConversationIdRef.current,
                    leavingChat: leavingChatRef.current,
                    onChatRoute,
                });
                setLastRealtimeError(null);
                setLastInboundError(null);
                selfRef.current = frame.user;
                setSelfAccount(frame.user);
                iceServersRef.current = frame.iceServers;
                const chain = chainIdRef.current;
                if (chain) {
                    try {
                        const loaded = loadPendingMessages(
                            chain,
                            frame.user,
                        ).filter((row) => row.status !== "sent");
                        const byId = Object.fromEntries(
                            loaded.map((row) => [row.clientMsgId, row]),
                        );
                        pendingMessagesRef.current = byId;
                        setPendingMessages(byId);
                        for (const row of loaded) {
                            upsertPendingTimelineRow(row);
                        }
                        storageFailureRef.current = null;
                    } catch (e) {
                        const detail =
                            e instanceof Error
                                ? e.message
                                : "Could not read pending message storage.";
                        storageFailureRef.current = detail;
                        setLastInboundError(
                            `Pending message storage is unavailable or corrupted: ${detail}. Offline messages cannot be restored in this browser.`,
                        );
                    }
                }
                syncKnownConversations();
                void restoreDmHistoryFromStore(frame.user);
                void restoreGroupHistoryFromStore(frame.user);
                void restoreObjectiveCallEvents();
                for (const conv of conversationsRef.current) {
                    if (conv.kind === "group" && conv.members.length > 2) {
                        void discoverActiveGroupAvCallInviteRef.current(
                            conv.conversationId,
                            conv.members,
                        );
                    }
                }
                if (webrtcClient.isReconnectWelcome()) {
                    transportBridgeRef.current?.invalidateJoinStateForWelcomeReconnect();
                    transportBridgeRef.current?.reconcileAfterReconnect();
                    avCallOrchestratorRef.current?.reconcileAfterReconnect();
                }
                const selected = selectedConversationIdRef.current;
                if (!leavingChatRef.current && selected) {
                    const conversation = conversationsRef.current.find(
                        (row) => row.conversationId === selected,
                    );
                    if (
                        (conversation?.kind === "dm" &&
                            conversation.members.length === 2) ||
                        (conversation?.kind === "group" &&
                            conversation.members.length > 2)
                    ) {
                        recordChurnTrace("ws-welcome-ensure-selected", {
                            selected,
                            kind: conversation.kind,
                            memberCount: conversation.members.length,
                        });
                        transportBridgeRef.current?.ensureChatDataSession(
                            conversation.conversationId,
                            conversation.members,
                        );
                    } else {
                        recordChurnTrace(
                            "ws-welcome-no-selected-conversation",
                            {
                                selected,
                                conversationKind: conversation?.kind ?? null,
                            },
                        );
                    }
                }
                void loadObjectiveSpacesRef.current();
                globalThis.setTimeout(
                    () => flushPendingMessagesRef.current(),
                    0,
                );
            },
            presenceSnapshot: (frame: {
                contacts: { account: string; presence: string }[];
            }) => {
                presenceReadyRef.current = true;
                setPresenceReady(true);
                setLastRealtimeError(null);
                const self = selfRef.current;
                const merged: Record<string, PresenceUi> = {
                    ...presenceByAccountRef.current,
                };
                for (const row of frame.contacts) {
                    const acct = row.account;
                    if (self && acct === self) continue;
                    if (!shouldAcceptInboundFrom(acct)) continue;
                    merged[acct] =
                        row.presence === "online" ? "online" : "offline";
                }
                presenceByAccountRef.current = merged;
                setPresenceByAccount(merged);
                const selected = selectedConversationIdRef.current;
                if (selected) {
                    const conversation = conversationsRef.current.find(
                        (row) => row.conversationId === selected,
                    );
                    if (
                        (conversation?.kind === "dm" &&
                            conversation.members.length === 2) ||
                        (conversation?.kind === "group" &&
                            conversation.members.length > 2)
                    ) {
                        transportBridgeRef.current?.ensureChatDataSession(
                            conversation.conversationId,
                            conversation.members,
                        );
                    }
                }
                for (const pending of Object.values(
                    pendingMessagesRef.current,
                )) {
                    if (pending.status !== "pending") continue;
                    for (const recipient of pending.recipients) {
                        if (merged[recipient] !== "online") continue;
                        const spaceId = spaceUuidFromConversationId(
                            pending.conversationId,
                        );
                        const conversation = conversationsRef.current.find(
                            (row) => row.conversationId === spaceId,
                        );
                        const dmMembers =
                            conversation?.members ??
                            (self
                                ? canonicalDmMembers(self, pending.recipients)
                                : null);
                        if (dmMembers) {
                            transportBridgeRef.current?.ensureChatDataSession(
                                spaceId,
                                dmMembers,
                            );
                        } else if (
                            conversation?.kind === "group" &&
                            conversation.members.length > 2
                        ) {
                            transportBridgeRef.current?.ensureChatDataSession(
                                spaceId,
                                conversation.members,
                            );
                        }
                    }
                }
                for (const [acct, status] of Object.entries(merged)) {
                    if (status === "online") {
                        transportBridgeRef.current?.onPeerOnline(acct);
                        avCallOrchestratorRef.current?.onPeerOnline(acct);
                    }
                }
                globalThis.setTimeout(
                    () => flushPendingMessagesRef.current(),
                    0,
                );
            },
            presence: (frame: { account: string; status: string }) => {
                const self = selfRef.current;
                if (self && frame.account === self) return;
                if (!shouldAcceptInboundFrom(frame.account)) return;
                const nextStatus: PresenceUi =
                    frame.status === "online" ? "online" : "offline";
                const wasOnline =
                    presenceByAccountRef.current[frame.account] === "online";
                patchPresenceRef(frame.account, nextStatus);
                setPresenceByAccount((prev) => {
                    if (prev[frame.account] === nextStatus) return prev;
                    return { ...prev, [frame.account]: nextStatus };
                });
                if (nextStatus === "online") {
                    if (!wasOnline) {
                        composeTimingLog("presence-online", {
                            account: frame.account,
                        });
                        scheduleSpacesReloadOnPresenceOnline();
                    }
                    const self = selfRef.current;
                    if (self) {
                        for (const pending of Object.values(
                            pendingMessagesRef.current,
                        )) {
                            if (pending.status !== "pending") continue;
                            if (!pending.recipients.includes(frame.account)) {
                                continue;
                            }
                            const spaceId = spaceUuidFromConversationId(
                                pending.conversationId,
                            );
                            const conversation = conversationsRef.current.find(
                                (row) => row.conversationId === spaceId,
                            );
                            const dmMembers =
                                conversation?.members ??
                                canonicalDmMembers(self, pending.recipients);
                            if (dmMembers) {
                                transportBridgeRef.current?.ensureChatDataSession(
                                    spaceId,
                                    dmMembers,
                                );
                            } else if (
                                conversation?.kind === "group" &&
                                conversation.members.length > 2
                            ) {
                                transportBridgeRef.current?.ensureChatDataSession(
                                    spaceId,
                                    conversation.members,
                                );
                            }
                        }
                    }
                    transportBridgeRef.current?.onPeerOnline(frame.account);
                    avCallOrchestratorRef.current?.onPeerOnline(frame.account);
                    const selected = selectedConversationIdRef.current;
                    if (selected) {
                        const conversation = conversationsRef.current.find(
                            (row) => row.conversationId === selected,
                        );
                        if (
                            ((conversation?.kind === "dm" &&
                                conversation.members.length === 2) ||
                                (conversation?.kind === "group" &&
                                    conversation.members.length > 2)) &&
                            conversation.members.includes(frame.account)
                        ) {
                            transportBridgeRef.current?.ensureChatDataSession(
                                conversation.conversationId,
                                conversation.members,
                            );
                        }
                    }
                    globalThis.setTimeout(
                        () => flushPendingMessagesRef.current(),
                        0,
                    );
                } else {
                    transportBridgeRef.current?.onPeerOffline(frame.account);
                    avCallOrchestratorRef.current?.onPeerOffline(frame.account);
                }
            },
            error: (frame: { code: string; reason: string }) => {
                setLastRealtimeError(
                    `${frame.code}: ${frame.reason}`.slice(0, 500),
                );
            },
        });

        installChatDataDebugGlobal();
        installThreadLifecycleGlobal();

        if (!transportBridgeRef.current) {
            transportBridgeRef.current = createChatTransportBridge({
                getRealtime: () => realtimeClientRef.current,
                getSelf: () => selfRef.current,
                getChainId: () => chainIdRef.current,
                getIceServers: () => iceServersRef.current,
                onInboundMessage: (envelope) => {
                    const self = selfRef.current;
                    let conversation = conversationsRef.current.find(
                        (row) => row.conversationId === envelope.spaceUuid,
                    );
                    if (!conversation && self) {
                        reloadSpacesIfMissing(envelope.spaceUuid);
                        conversation = resolveVisibleConversation(
                            envelope.spaceUuid,
                            self,
                            objectiveSpacesRef.current,
                            contactAccountsRef.current,
                            contactsLoadedRef.current,
                        );
                    }
                    if (conversation?.kind === "group") {
                        return applyInboundGroupDataChannelMessageRef.current(
                            envelope,
                        );
                    }
                    return applyInboundDmDataChannelMessageRef.current(
                        envelope,
                    );
                },
                onInboundHistorySync: (envelope) => {
                    reloadSpacesIfMissing(envelope.spaceUuid);
                    if (
                        isGroupHistorySyncSpace(
                            envelope.spaceUuid,
                            conversationsRef.current,
                            objectiveSpacesRef.current,
                        )
                    ) {
                        void applyInboundGroupHistorySyncRef.current(envelope);
                    } else {
                        void applyInboundDmHistorySyncRef.current(envelope);
                    }
                },
                onPeerUsable: (peerAccount) => {
                    const self = selfRef.current;
                    if (!self) return;
                    void drainHistorySyncPushForPeerRef.current(peerAccount);
                    for (const conv of conversationsRef.current) {
                        if (
                            conv.kind === "group" &&
                            conv.members.includes(peerAccount)
                        ) {
                            void pushGroupHistorySyncRef.current(
                                conv.conversationId,
                                peerAccount,
                            );
                        } else if (
                            conv.kind === "dm" &&
                            conv.members.includes(peerAccount)
                        ) {
                            void pushDmHistorySyncRef.current(
                                conv.conversationId,
                                peerAccount,
                            );
                        }
                    }
                },
                onSessionInvite: (spaceUuid) => {
                    const self = selfRef.current;
                    if (!self) return;
                    void loadObjectiveSpacesRef.current().then((spaces) => {
                        const stillMissing =
                            resolveVisibleConversation(
                                spaceUuid,
                                self,
                                spaces,
                                contactAccountsRef.current,
                                contactsLoadedRef.current,
                            ) === undefined;
                        if (!stillMissing) return;
                        globalThis.setTimeout(() => {
                            void loadObjectiveSpacesRef.current();
                        }, 800);
                    });
                },
                onSpaceMembershipHint: () => {
                    void loadObjectiveSpacesRef.current();
                },
                onMessageAck: (spaceUuid, envelope) => {
                    reloadSpacesIfMissing(spaceUuid);
                    chatDataLog("message ack received", {
                        space: shortSpaceId(spaceUuid),
                        from: envelope.from,
                        clientMsgId: envelope.clientMsgId,
                    });
                    markDmPendingDeliveredRef.current(
                        envelope.clientMsgId,
                        envelope.from,
                        spaceUuid,
                    );
                },
                getRemotePresence: (account) => {
                    const presence = presenceByAccountRef.current[account];
                    if (presence === "online" || presence === "offline") {
                        return presence;
                    }
                    return undefined;
                },
            });
        }
        const chatBridge = transportBridgeRef.current;
        chatBridge?.start();
        chatBridge?.installDebugGlobal();

        avCallOrchestratorRef.current = new AvCallSessionOrchestrator(
            () => realtimeClientRef.current,
            () => selfRef.current,
            () => iceServersRef.current,
            () => presenceByAccountRef.current,
            (invite) => {
                const self = selfRef.current;
                const isGroupInvite =
                    !!self &&
                    (invite.participants?.length ?? 0) > 2 &&
                    invite.participants?.includes(self);
                const accepted = isGroupInvite
                    ? shouldAcceptGroupAvCallInvite(
                          invite,
                          self!,
                          shouldAcceptInboundFrom,
                          contactAccountsRef.current,
                          contactsLoadedRef.current,
                      )
                    : shouldAcceptAvCallInvite(
                          invite.from,
                          shouldAcceptInboundFrom,
                      );
                if (!accepted) {
                    return;
                }
                if (
                    self &&
                    needsSpaceReloadForAvCallInvite(
                        invite.spaceUuid,
                        self,
                        objectiveSpacesRef.current,
                        contactAccountsRef.current,
                        contactsLoadedRef.current,
                    )
                ) {
                    void loadObjectiveSpacesRef.current();
                }
                setIncomingAvCallInvite(invite);
            },
            () => {
                setIncomingAvCallInvite(null);
            },
            (spaceUuid, snap) => {
                syncAvCallUiRef.current(spaceUuid, snap);
            },
            (spaceUuid, info) => {
                onAvCallMediaReadyRef.current(spaceUuid, info);
            },
            (sessionId, participant, state) => {
                onAvCallParticipantStateRef.current(
                    sessionId,
                    participant,
                    state,
                );
            },
            () => transportBridgeRef.current?.signaling ?? null,
            (spaceUuid) =>
                isGroupMeetLeaveInProgress(
                    groupMeetLifecycleRef.current,
                    spaceUuid,
                ),
            () => transportBridgeRef.current?.deliveryFabric ?? null,
        );
        avCallOrchestratorRef.current.start();

        return () => {
            unregisterHandlers();
            if (ringOutTimerRef.current != null) {
                globalThis.clearTimeout(ringOutTimerRef.current);
                ringOutTimerRef.current = null;
            }
            if (terminalCallDismissTimerRef.current != null) {
                globalThis.clearTimeout(terminalCallDismissTimerRef.current);
                terminalCallDismissTimerRef.current = null;
            }
            // Keep transport bridge alive across handler re-registration — disposing
            // here races with async chainId/space loads and drops in-flight sends.
            // Handler re-registration must not publish leaveSession — only explicit
            // user hangup (endPlaceholderCall) or chat navigation teardown may.
            avCallOrchestratorRef.current?.dispose({ publishLeave: false });
            avCallOrchestratorRef.current = null;
            setIncomingAvCallInvite(null);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- chat handlers read latest state via refs
    }, [webrtcClient, registerHandlers, markSignalingTeardown]);

    const discoverActiveGroupAvCallInvite = useCallback(
        async (spaceUuid: string, members: readonly string[]) => {
            const orch = avCallOrchestratorRef.current;
            const self = selfRef.current;
            if (!orch || !self) return;
            try {
                const events = await fetchSpaceCallEvents(spaceUuid);
                await orch.discoverActiveGroupAvCallInvite(
                    spaceUuid,
                    members,
                    events,
                    {
                        activeCallConversationId:
                            activeCallRef.current?.conversationId,
                        contactsLoaded: contactsLoadedRef.current,
                        contactAccounts: contactAccountsRef.current,
                    },
                );
            } catch {
                /* Non-fatal; websocket sessionInvite may still arrive. */
            }
        },
        [],
    );
    discoverActiveGroupAvCallInviteRef.current =
        discoverActiveGroupAvCallInvite;

    useEffect(() => {
        if (!selectedConversationId || !contactsLoaded) return;
        if (leavingChatRef.current) {
            recordChurnTrace("selection-ensure-skipped-leaving-chat", {
                selectedConversationId,
            });
            return;
        }
        const self = selfAccount;
        if (!self) return;

        const conversation = conversations.find(
            (row) => row.conversationId === selectedConversationId,
        );
        if (conversation?.kind === "dm" && conversation.members.length === 2) {
            scheduleDmChatDataSession(
                conversation.conversationId,
                conversation.members,
            );
            return;
        }

        if (conversation?.kind === "group" && conversation.members.length > 2) {
            scheduleGroupChatDataSession(
                conversation.conversationId,
                conversation.members,
            );
            void discoverActiveGroupAvCallInvite(
                conversation.conversationId,
                conversation.members,
            );
            return;
        }

        const spaceId = spaceUuidFromConversationId(
            selectedConversationId,
        );
        if (!spaceId.startsWith("space:")) return;

        const peer =
            pendingDmMemberRef.current ??
            conversation?.members.find((member) => member !== self);
        if (peer) {
            scheduleDmChatDataSession(spaceId, [self, peer]);
        }
    }, [
        contactsLoaded,
        conversations,
        selectedConversationId,
        scheduleDmChatDataSession,
        scheduleGroupChatDataSession,
        discoverActiveGroupAvCallInvite,
        selfAccount,
    ]);

    const location = useLocation();
    const onChatRoute =
        location.pathname === "/chat" || location.pathname.startsWith("/chat/");

    // chainId resolves async from GraphQL; retry stack start once it is available.
    useEffect(() => {
        const bridge = transportBridgeRef.current;
        if (!bridge || !chainId || !selfAccount || !onChatRoute) return;
        bridge.start();
        bridge.installDebugGlobal();
    }, [chainId, selfAccount, connectionState, onChatRoute, location.pathname]);

    const churnLagRef = useRef({
        lastTickAt: Date.now(),
        maxLagMs: 0,
        lastLagMs: 0,
    });

    useEffect(() => {
        const intervalMs = 500;
        churnLagRef.current.lastTickAt = Date.now();
        const timer = globalThis.setInterval(() => {
            const now = Date.now();
            const elapsed = now - churnLagRef.current.lastTickAt;
            const lag = Math.max(0, elapsed - intervalMs);
            churnLagRef.current = {
                lastTickAt: now,
                lastLagMs: lag,
                maxLagMs: Math.max(churnLagRef.current.maxLagMs, lag),
            };
            if (lag > 2_000) {
                recordChurnTrace("event-loop-lag", { lagMs: lag });
            }
        }, intervalMs);
        return () => globalThis.clearInterval(timer);
    }, []);

    /** Stop mesh/flush work without disposing — use before shell navigation commits. */
    const suspendChatNavigation = useCallback(() => {
        const startedAt = Date.now();
        leavingChatRef.current = true;
        if (flushDebounceRef.current != null) {
            globalThis.clearTimeout(flushDebounceRef.current);
            flushDebounceRef.current = null;
        }
        if (transportBridgeRef.current?.isNavigationSuspended()) {
            recordChurnTrace("navigation-suspend-skip-duplicate", {
                pathname: location.pathname,
                selectedConversationId: selectedConversationIdRef.current,
            });
            return;
        }
        recordChurnTrace("navigation-suspend", {
            pathname: location.pathname,
            selectedConversationId: selectedConversationIdRef.current,
            realtimeState: realtimeClientRef.current?.state ?? null,
            realtimeReady: realtimeClientRef.current?.isSessionReady ?? null,
            lag: churnLagRef.current,
        });
        transportBridgeRef.current?.suspendForNavigation();
        recordChurnTrace("navigation-suspend-return", {
            elapsedMs: Date.now() - startedAt,
            churnState: {
                leavingChat: leavingChatRef.current,
                hasTransportBridge: Boolean(transportBridgeRef.current),
                navigationSuspended:
                    transportBridgeRef.current?.isNavigationSuspended() ??
                    false,
            },
        });
    }, [location.pathname, selectedConversationIdRef]);

    /** Drop transport stack + aux WS while staying on Chat (e2e prepare-nav). */
    const dropChatTransportForNavigation = useCallback(() => {
        if (flushDebounceRef.current != null) {
            globalThis.clearTimeout(flushDebounceRef.current);
            flushDebounceRef.current = null;
        }
        recordChurnTrace("transport-drop-start", {
            transportBridge: Boolean(transportBridgeRef.current),
            avCallOrchestrator: Boolean(avCallOrchestratorRef.current),
            selectedConversationId: selectedConversationId ?? null,
            pathname: location.pathname,
            onChatRoute,
        });
        transportBridgeRef.current?.dropTransportStack();
        avCallOrchestratorRef.current?.dispose({ publishLeave: true });
        avCallOrchestratorRef.current = null;
        recordChurnTrace("transport-drop-done", {
            transportBridge: Boolean(transportBridgeRef.current),
        });
    }, [selectedConversationId, location.pathname, onChatRoute]);

    const teardownChatRealtime = useCallback(() => {
        leavingChatRef.current = true;
        if (flushDebounceRef.current != null) {
            globalThis.clearTimeout(flushDebounceRef.current);
            flushDebounceRef.current = null;
        }
        recordChurnTrace("teardown-start", {
            transportBridge: Boolean(transportBridgeRef.current),
            avCallOrchestrator: Boolean(avCallOrchestratorRef.current),
            selectedConversationId: selectedConversationId ?? null,
            pathname: location.pathname,
        });
        transportBridgeRef.current?.dropStackForNavigation();
        avCallOrchestratorRef.current?.dispose({ publishLeave: true });
        avCallOrchestratorRef.current = null;
        webrtcClient?.close();
        recordChurnTrace("teardown-done", {
            transportBridge: Boolean(transportBridgeRef.current),
            avCallOrchestrator: Boolean(avCallOrchestratorRef.current),
            leavingChat: leavingChatRef.current,
        });
    }, [webrtcClient, selectedConversationId, location.pathname]);

    /** Tear down WebRTC before Chat unmount so shell navigation does not wedge. */
    useEffect(() => {
        if (onChatRoute) {
            const enteringChat = !wasOnChatRouteRef.current;
            wasOnChatRouteRef.current = true;
            if (enteringChat) {
                leavingChatRef.current = false;
                transportBridgeRef.current?.resumeAfterNavigation();
                recordChurnTrace("chat-route-enter", {
                    pathname: location.pathname,
                });
            }
            return;
        }
        wasOnChatRouteRef.current = false;
        recordChurnTrace("chat-route-leave", {
            pathname: location.pathname,
            leavingChat: leavingChatRef.current,
        });
        teardownChatRealtime();
    }, [onChatRoute, teardownChatRealtime, location.pathname]);

    // H28: focused-space flush priority + idle-transport policy live on
    // MessagingService (setFocusedSpace), not here — the adapter only
    // forwards selection intent.
    useEffect(() => {
        if (!contactsLoaded) return;
        transportBridgeRef.current?.setFocusedSpace(selectedConversationId);
    }, [contactsLoaded, pendingDeliveryCount, selectedConversationId]);

    const reconnectNow = useCallback(() => {
        reconnectWebRtcSession();
    }, [reconnectWebRtcSession]);

    return {
        onChatRoute,
        location,
        suspendChatNavigation,
        dropChatTransportForNavigation,
        reconnectNow,
        churnLagRef,
    };
}
