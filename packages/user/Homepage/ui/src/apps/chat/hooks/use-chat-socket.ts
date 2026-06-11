import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";

import { useChainId } from "@shared/hooks/use-chain-id";
import {
    useWebRtcSession,
} from "@shared/domains/webrtc";

import type {
    CallTimelineEventType,
    ConversationSnapshot,
    IceServerConfig,
} from "../lib/protocol";

import { recordChurnTrace } from "../lib/churn-trace";
import { chatDataRecord } from "../lib/chat-data-debug";
import { RealtimeClient } from "../lib/realtime-client";
import { getHomepageQueryToken } from "../lib/ws-auth";
import { ChatTransportBridge } from "../transport/chat-transport-bridge";
import {
    AvCallSessionOrchestrator,
    type AvCallIncomingInvite,
    type AvCallSessionPhase,
    type AvCallSessionSnapshot,
} from "../lib/av-call-session-orchestrator";
import { avCallConnectivityErrorMessage } from "../lib/av-call-session-types";
import {
    avCallTerminalUiMessage,
    isAvCallTerminalReason,
} from "../lib/av-call-terminal";
import {
    anyGroupMeetJoined,
    buildGroupMeetParticipants,
    buildGroupMeetRemoteStreamMap,
    groupMeetDisplayPeer,
    groupMeetStatusLabel,
    type GroupMeetParticipant,
} from "../lib/group-meet-ui-state";
import {
    chatDataLog,
    installChatDataDebugGlobal,
    shortSpaceId,
} from "../lib/chat-data-debug";
import type { ChatDataMessageEnvelope, ChatHistorySyncEnvelope } from "../lib/chat-data-envelope";

import { ensureDm, ensureGroup, fetchSpaceCallEvents } from "../lib/chat-api";

import { useObjectiveSpaces } from "./chat/use-objective-spaces";
import { useConversationSelection } from "./chat/use-conversation-selection";
import { createChatTransportBridge } from "./chat/use-chat-orchestrator";
import { mergeObjectiveCallEventsIntoTimeline } from "../lib/call-timeline-bridge";
import {
    conversationVisibleToUser,
    isInboundContactPeer,
} from "../lib/contacts-policy";
import {
    findVisibleDmWithPeer,
    needsSpaceReloadForAvCallInvite,
    resolveVisibleConversation,
    shouldAcceptAvCallInvite,
} from "../lib/dm-contacts-meet-flow";
import {
    findVisibleGroupWithMembers,
    memberCanonicalKey,
    shouldAcceptGroupAvCallInvite,
} from "../lib/group-contacts-meet-flow";
import {
    isDeliveryOpenPeer,
    markDeliveryOpenPeer,
    seedDeliveryOpenPeersFromGroupHistory,
    seedDeliveryOpenPeersFromHistory,
} from "../lib/delivery-open-peers";
import {
    buildDmEnvelope,
    dmPeerAccount,
    getDmMessageHistoryStore,
} from "../lib/dm-message-history-store";
import {
    envelopesToHistorySyncMessages,
    historySyncToDmEnvelopes,
} from "../lib/dm-history-sync";
import {
    historySyncToGroupEnvelopes,
    isGroupHistorySyncSpace,
    resolveGroupMembersForHistorySync,
} from "../lib/group-history-sync";
import { listInboundAckTargets } from "../lib/inbound-message-ack";
import { inboundMessageAcceptance } from "../lib/inbound-message-acceptance";
import type { InboundMessageAcceptance } from "../lib/inbound-message-acceptance";
import {
    dequeueHistorySyncPush,
    enqueueHistorySyncPush,
    historySyncPushForPeer,
} from "../lib/history-sync-push-queue";
import { dmComposerDisabledReason } from "../lib/dm-compose-ux";
import { composeTimingLog } from "../lib/dm-compose-timing";
import {
    installThreadLifecycleGlobal,
    peerStatesForRemotes,
    recordThreadLifecycle,
    threadLifecycleSnapshot,
} from "../lib/thread-lifecycle";
import {
    dmMembersForPendingPeer,
    findDmConversationWithPeer,
    resolveComposeSurfaceConversationId,
    shouldQueueFirstDmUntilSpace,
} from "../lib/dm-first-message-send";
import {
    mergeTimelineMessagesBySendTimestamp,
} from "../lib/dm-message-history-ui";
import {
    buildGroupEnvelope,
    getGroupMessageHistoryStore,
} from "../lib/group-message-history-store";
import {
    mergeTimelineMessagesWithGroupHistory,
} from "../lib/group-message-history-ui";
import {
    deriveSpaceUuidForCanonicalMembers,
    pslackConversationIdFromSpaceUuid,
    spaceEntryToConversation,
    spaceUuidFromPslackConversationId,
    type GraphqlSpaceEntry,
} from "../lib/space-bridge";
import {
    loadPendingMessages,
    savePendingMessagesWithQuotaRecovery,
    type PendingChatMessage,
    type PendingMessageStoreError,
} from "../lib/pending-message-store";

import { useContacts } from "@shared/hooks/use-contacts";
import { useCurrentUser } from "@shared/hooks/use-current-user";

const TERMINAL_CALL_TIMELINE_EVENTS = new Set<CallTimelineEventType>([
    "declined",
    "missed",
    "cancelled",
    "failed",
    "ended",
]);

/** Cleared-call IDs — suppress spurious `bad-call` from late signaling after teardown (decline, hangup, etc.). */
const SIGNALING_TEARDOWN_SUPPRESS_MS = 12_000;
const AV_CALL_TERMINAL_DISMISS_MS = 2_500;

import type {
    PslackTimelineCallEventRow,
    PslackTimelineMessageRow,
    PslackTimelineRow,
    PresenceUi,
} from "../lib/chat-timeline-types";
import {
    pendingRecipientCount,
    pendingToTimelineRow,
    sortTimelineRows,
} from "../lib/chat-timeline-types";

export type {
    PslackMessageStatus,
    PslackUiMessage,
    PslackTimelineMessageRow,
    PslackTimelineCallEventRow,
    PslackTimelineRow,
    PresenceUi,
} from "../lib/chat-timeline-types";

export type PslackIncomingCall = {
    callId: string;
    conversationId: string;
    from: string;
    to: string;
    wantVideo: boolean;
    wantAudio: boolean;
    serverTime: number;
    source: "av-call";
    /** N-party group Meet when >2 session participants. */
    groupParticipantCount?: number;
};

export type PslackActiveCall = {
    callId: string;
    conversationId: string;
    peerAccount: string;
    direction: "incoming" | "outgoing";
    wantVideo: boolean;
    wantAudio: boolean;
    startedAt: number;
    status: "ringing" | "connected" | "ended";
    source: "mock" | "av-call";
    lastFrame?: string;
    callKind?: "dm" | "group";
    groupParticipants?: GroupMeetParticipant[];
};

function avCallPhaseUiLabel(phase: AvCallSessionPhase): string {
    switch (phase) {
        case "ensuring":
        case "creating":
            return "Starting call…";
        case "joining":
            return "Joining session…";
        case "waiting-peer":
            return "Ringing…";
        case "signaling":
            return "Connecting…";
        case "ready":
            return "Connected";
        default:
            return "Calling…";
    }
}

/** Members for a DM pending row when objective Spaces are not loaded yet. */
function canonicalDmMembers(
    self: string,
    recipients: readonly string[],
): [string, string] | null {
    if (recipients.length !== 1) return null;
    const peer = recipients[0]!;
    return self.localeCompare(peer) < 0
        ? [self, peer]
        : [peer, self];
}

function userMessageForServerError(code: string, reason: string): string {
    if (
        code === "bad-frame" &&
        reason === "openDm member must be a different account"
    ) {
        return "Direct messages are for another account. Choose a contact other than yourself.";
    }

    return reason;
}

export type UseChatSocketOptions = {
    /** When set (e.g. `?space=`), overrides restored last-open chat. */
    urlConversationId?: string;
};

/** Chat UI state: objective Spaces (GraphQL) + x-webrtcsig presence/realtime + interim group websocket for group/call coordination (M3 DMs use data channel). */
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

    useEffect(() => {
        if (!currentUser) return;
        if (selfRef.current) return;
        selfRef.current = currentUser;
        setSelfAccount(currentUser);
    }, [currentUser]);

    const [lastRealtimeError, setLastRealtimeError] = useState<string | null>(
        null,
    );
    /** True after first `presenceSnapshot` on x-webrtcsig. */
    const [presenceReady, setPresenceReady] = useState(false);
    const presenceReadyRef = useRef(false);

    const [selfAccount, setSelfAccount] = useState<string | null>(null);
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
        setObjectiveSpaces,
        spacesLoadError,
        setSpacesLoadError,
        objectiveSpacesRef,
        loadObjectiveSpaces,
        loadObjectiveSpacesRef,
        scheduleSpacesReloadOnPresenceOnline,
        spacesReloadOnPresenceTimerRef,
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
        Record<string, PslackTimelineRow[]>
    >({});
    const [pendingMessages, setPendingMessages] = useState<
        Record<string, PendingChatMessage>
    >({});
    const [unreadByConversation, setUnreadByConversation] = useState<
        Record<string, number>
    >({});
    const [incomingCall, setIncomingCall] = useState<PslackIncomingCall | null>(
        null,
    );
    const [activeCall, setActiveCall] = useState<PslackActiveCall | null>(null);
    const [avCallLocalStream, setAvCallLocalStream] =
        useState<MediaStream | null>(null);
    const [avCallRemoteStreamsByAccount, setAvCallRemoteStreamsByAccount] =
        useState<Record<string, MediaStream | null>>({});
    const [avCallRemoteStream, setAvCallRemoteStream] =
        useState<MediaStream | null>(null);
    const [avCallAudioMuted, setAvCallAudioMuted] = useState(false);
    const [avCallVideoMuted, setAvCallVideoMuted] = useState(false);
    const [avCallRemoteAudioMuted, setAvCallRemoteAudioMuted] = useState(false);
    const [avCallRemoteVideoMuted, setAvCallRemoteVideoMuted] = useState(false);
    const [avCallRemoteAvStateByAccount, setAvCallRemoteAvStateByAccount] =
        useState<
            Record<string, { audioMuted?: boolean; videoMuted?: boolean }>
        >({});
    const [avCallAudioOnlyFallback, setAvCallAudioOnlyFallback] =
        useState(false);

    const iceServersRef = useRef<IceServerConfig[] | null>(null);

    const [lastInboundError, setLastInboundError] = useState<string | null>(null);
    /** Plan C4: pending-message storage quota exceeded; cleared by next clean save. */
    const [pendingStorageQuotaExceeded, setPendingStorageQuotaExceeded] =
        useState(false);

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

    const transportBridgeRef = useRef<ChatTransportBridge | null>(
        null,
    );
    const avCallOrchestratorRef = useRef<AvCallSessionOrchestrator | null>(
        null,
    );
    /** True while tearing down or navigating away from Chat (blocks new ensures). */
    const leavingChatRef = useRef(false);
    /** Previous effect tick was on a chat route (detect enter vs still-on-chat). */
    const wasOnChatRouteRef = useRef(false);
    const [incomingAvCallInvite, setIncomingAvCallInvite] =
        useState<AvCallIncomingInvite | null>(null);
    const selfRef = useRef<string | null>(null);

    const shouldAcceptInboundFrom = (account: string): boolean =>
        isInboundContactPeer(
            selfRef.current,
            account,
            contactAccountsRef.current,
            contactsLoadedRef.current,
        );

    const conversationIdsRef = useRef<string[]>([]);
    const pendingMessagesRef = useRef<Record<string, PendingChatMessage>>({});
    const storageFailureRef = useRef<string | null>(null);
    const inFlightDeliveriesRef = useRef<Set<string>>(new Set());

    const pendingGroupKeyRef = useRef<string | null>(null);

    const ringOutTimerRef = useRef<ReturnType<
        typeof globalThis.setTimeout
    > | null>(null);
    const terminalCallDismissTimerRef = useRef<ReturnType<
        typeof globalThis.setTimeout
    > | null>(null);

    const activeCallRef = useRef<PslackActiveCall | null>(null);
    const hangupInitiatedCallIdRef = useRef<string | null>(null);
    const avCallDirectionRef = useRef<"incoming" | "outgoing">("outgoing");
    const avCallUiArmedRef = useRef<string | null>(null);
    const syncAvCallUiRef = useRef<
        (spaceUuid: string, snap: AvCallSessionSnapshot) => void
    >(() => {});
    const onAvCallMediaReadyRef = useRef<
        (
            spaceUuid: string,
            info: {
                peerAccount: string;
                localStream: MediaStream;
                remoteStream: MediaStream | null;
            },
        ) => void
    >(() => {});
    const onAvCallParticipantStateRef = useRef<
        (
            sessionId: string,
            participant: string,
            state: {
                audioMuted?: boolean;
                videoMuted?: boolean;
            },
        ) => void
    >(() => {});
    const avCallAudioMutedRef = useRef(false);
    const avCallVideoMutedRef = useRef(false);
    avCallAudioMutedRef.current = avCallAudioMuted;
    avCallVideoMutedRef.current = avCallVideoMuted;
    const recentSignalingTeardownIdsRef = useRef<Set<string>>(new Set());

    const markSignalingTeardown = useCallback(
        (callId: string | undefined) => {
            if (!callId) return;
            recentSignalingTeardownIdsRef.current.add(callId);
            globalThis.setTimeout(() => {
                recentSignalingTeardownIdsRef.current.delete(callId);
            }, SIGNALING_TEARDOWN_SUPPRESS_MS);
        },
        [],
    );

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

    const discoverActiveGroupAvCallInviteRef = useRef(
        async (_spaceUuid: string, _members: readonly string[]) => {},
    );

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

    const pslackIdsForSpaces = useCallback((spaces: GraphqlSpaceEntry[]) => {
        return spaces.map((space) =>
            pslackConversationIdFromSpaceUuid(space.space_uuid),
        );
    }, []);

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
        conversationIdsRef.current = pslackIdsForSpaces(visible);
    }, [
        objectiveSpaces,
        selfAccount,
        contactAccounts,
        contactsLoaded,
        pslackIdsForSpaces,
    ]);

    const syncKnownConversations = useCallback(() => {
        /* Objective spaces load via GraphQL; x-webrtc-sig has no conversation sync. */
    }, []);

    pendingMessagesRef.current = pendingMessages;

    activeCallRef.current = activeCall;
    if (!activeCall) hangupInitiatedCallIdRef.current = null;

    const incomingCallRef = useRef<PslackIncomingCall | null>(null);
    incomingCallRef.current = incomingCall;

    const trySelectPendingConversation = useCallback(
        (conv: ConversationSnapshot) => {
            const self = selfRef.current;
            if (!self) return;

            const pendDm = pendingDmMemberRef.current;
            if (pendDm !== null && conv.kind === "dm") {
                if (
                    conv.members.includes(pendDm) &&
                    conv.members.includes(self)
                ) {
                    pendingDmMemberRef.current = null;
                    setSelectedConversationId(conv.conversationId);
                }
                return;
            }

            const pendGrp = pendingGroupKeyRef.current;
            if (
                pendGrp !== null &&
                conv.kind === "group" &&
                memberCanonicalKey(conv.members) === pendGrp
            ) {
                pendingGroupKeyRef.current = null;
                setSelectedConversationId(conv.conversationId);
            }
        },
        [],
    );

    const selectSpaceByMembers = useCallback(
        (members: readonly string[]) => {
            const key = memberCanonicalKey(members);
            const match = conversationsRef.current.find(
                (row) => memberCanonicalKey(row.members) === key,
            );
            if (match) {
                setSelectedConversationId(match.conversationId);
            }
        },
        [],
    );

    const persistDmHistoryMessage = useCallback(
        async (input: {
            spaceUuid: string;
            from: string;
            body: string;
            sendTimestamp: number;
            clientMsgId?: string;
            serverMsgId?: number;
            fallbackKey?: string;
        }) => {
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
                space && "members" in space
                    ? space.members
                    : undefined;
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
        async (input: {
            spaceUuid: string;
            from: string;
            body: string;
            sendTimestamp: number;
            clientMsgId?: string;
            serverMsgId?: number;
            fallbackKey?: string;
        }) => {
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
                        (row): row is PslackTimelineMessageRow =>
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
                              } satisfies PslackTimelineMessageRow)
                            : ({
                                  ...row,
                                  kind: "message" as const,
                              } satisfies PslackTimelineMessageRow);
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

    const restoreGroupHistoryFromStore = useCallback(async (account: string) => {
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
                        (row): row is PslackTimelineMessageRow =>
                            row.kind === "message",
                    );
                    const mergedMessages = mergeTimelineMessagesWithGroupHistory(
                        existingMessages,
                        envelopes,
                    ).map(
                        (row) =>
                            ({
                                ...row,
                                kind: "message" as const,
                            }) satisfies PslackTimelineMessageRow,
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
    }, []);

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
                        (row): row is PslackTimelineCallEventRow =>
                            row.kind === "callEvent" &&
                            !row.key.startsWith("obj-"),
                    );
                    const objectiveExisting = existing.filter(
                        (row): row is PslackTimelineCallEventRow =>
                            row.kind === "callEvent" &&
                            row.key.startsWith("obj-"),
                    );
                    const messages = existing.filter(
                        (row): row is PslackTimelineMessageRow =>
                            row.kind === "message",
                    );
                    const mergedObjective = mergeObjectiveCallEventsIntoTimeline(
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
                refreshObjectiveCallEventsForSpaceRef.current(
                    space.space_uuid,
                ),
            ),
        );
    }, []);

    useEffect(() => {
        if (!selfAccount || objectiveSpaces.length === 0) return;
        void restoreObjectiveCallEvents();
    }, [selfAccount, objectiveSpaces, restoreObjectiveCallEvents]);

    const markConversationSendFailed = useCallback(
        (conversationId: string | undefined, detail: string) => {
            if (!conversationId) return;
            const spaceConvId = spaceUuidFromPslackConversationId(conversationId);
            setTimelineByConversation((prev) => {
                const arr = [...(prev[spaceConvId] ?? [])];
                for (let i = arr.length - 1; i >= 0; i--) {
                    const row = arr[i];
                    if (
                        row?.kind === "message" &&
                        row.status === "pending"
                    ) {
                        arr[i] = {
                            ...row,
                            status: "failed",
                            errorReason: detail,
                        };
                        break;
                    }
                }
                return { ...prev, [spaceConvId]: arr };
            });
        },
        [],
    );

    const lastQuotaPromotedRef = useRef<readonly PendingChatMessage[]>([]);
    const persistPendingMessages = useCallback(
        (next: Record<string, PendingChatMessage>) => {
            const self = selfRef.current;
            const chain = chainIdRef.current;
            if (!self || !chain) return true;
            const rows = Object.values(next);
            const result = savePendingMessagesWithQuotaRecovery(
                chain,
                self,
                rows,
                {
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
                },
            );
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
        },
        [],
    );

    /**
     * After a `persistPendingMessages` call that triggered quota recovery,
     * apply the resulting `failed` promotions to the in-memory map and the
     * timeline. Separate from `persistPendingMessages` so the timeline-write
     * helpers (declared later) are in scope at call time.
     */
    const drainQuotaPromotions = useCallback(() => {
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
    }, []);

    const replacePendingMessages = useCallback(
        (
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
        },
        [drainQuotaPromotions, persistPendingMessages],
    );

    const upsertPendingTimelineRow = useCallback(
        (pending: PendingChatMessage) => {
            const row = pendingToTimelineRow(pending);
            const spaceId = spaceUuidFromPslackConversationId(
                pending.conversationId,
            );
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
        },
        [],
    );
    const upsertPendingTimelineRowRef = useRef(upsertPendingTimelineRow);
    upsertPendingTimelineRowRef.current = upsertPendingTimelineRow;

    const applyInboundChatMessage = useCallback(
        (frame: {
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

            const spaceId = spaceUuidFromPslackConversationId(
                frame.conversationId,
            );
            const selectedId = selectedConversationIdRef.current;
            const pendingPeer = composePendingDmPeerRef.current;
            if (pendingPeer === frame.from) {
                pendingDmMemberRef.current = null;
                setComposePendingDmPeer(null);
                if (selectedId !== spaceId) {
                    setSelectedConversationId(
                        spaceId,
                        "inbound-dm-pending-peer",
                    );
                }
            } else if (spaceId !== selectedId) {
                setUnreadByConversation((prev) => ({
                    ...prev,
                    [spaceId]: (prev[spaceId] ?? 0) + 1,
                }));
            }

            setTimelineByConversation((prev) => {
                const prevList = [...(prev[spaceId] ?? [])];
                const {
                    clientMsgId,
                    clientTime,
                    serverMsgId,
                    serverTime,
                    from,
                    body,
                } = frame;

                if (clientMsgId) {
                    const ix = prevList.findIndex(
                        (m) =>
                            m.kind === "message" &&
                            m.clientMsgId === clientMsgId,
                    );
                    if (ix >= 0) {
                        const cur = prevList[ix] as PslackTimelineMessageRow;
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
                        (m) =>
                            m.kind === "message" &&
                            m.serverMsgId === serverMsgId,
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
        },
        [persistDmHistoryMessage, setComposePendingDmPeer, setSelectedConversationId],
    );

    const applyInboundChatMessageRef = useRef(applyInboundChatMessage);
    applyInboundChatMessageRef.current = applyInboundChatMessage;

    const applyInboundDmDataChannelMessage = useCallback(
        (envelope: ChatDataMessageEnvelope): InboundMessageAcceptance => {
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
                conversationId: pslackConversationIdFromSpaceUuid(
                    envelope.spaceUuid,
                ),
                from: envelope.from,
                body: envelope.body,
                serverTime: envelope.sendTimestamp,
                clientMsgId: envelope.clientMsgId,
                clientTime: envelope.sendTimestamp,
            });
            return "accepted";
        },
        [],
    );

    const applyInboundGroupDataChannelMessage = useCallback(
        (envelope: ChatDataMessageEnvelope): InboundMessageAcceptance => {
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
                const callEvents = existing.filter(
                    (row) => row.kind === "callEvent",
                );
                const existingMessages = existing.filter(
                    (row): row is PslackTimelineMessageRow =>
                        row.kind === "message",
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
                        ({
                            ...row,
                            kind: "message" as const,
                        }) satisfies PslackTimelineMessageRow,
                );
                return {
                    ...prev,
                    [spaceId]: sortTimelineRows([
                        ...callEvents,
                        ...mergedMessages,
                    ]),
                };
            });

            void persistGroupHistoryMessage({
                spaceUuid: envelope.spaceUuid,
                from: envelope.from,
                body: envelope.body,
                sendTimestamp: envelope.sendTimestamp,
                clientMsgId: envelope.clientMsgId,
            });

            globalThis.setTimeout(
                () => flushPendingMessagesRef.current(),
                0,
            );
            return "accepted";
        },
        [persistGroupHistoryMessage],
    );

    const applyInboundDmHistorySync = useCallback(
        async (envelope: ChatHistorySyncEnvelope) => {
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
                const callEvents = existing.filter(
                    (row) => row.kind === "callEvent",
                );
                const existingMessages = existing.filter(
                    (row): row is PslackTimelineMessageRow =>
                        row.kind === "message",
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
                          } satisfies PslackTimelineMessageRow)
                        : ({
                              ...row,
                              kind: "message" as const,
                          } satisfies PslackTimelineMessageRow);
                });
                return {
                    ...prev,
                    [spaceUuid]: sortTimelineRows([
                        ...callEvents,
                        ...mergedMessages,
                    ]),
                };
            });

            globalThis.setTimeout(
                () => flushPendingMessagesRef.current(),
                0,
            );
        },
        [],
    );

    const applyInboundGroupHistorySync = useCallback(
        async (envelope: ChatHistorySyncEnvelope) => {
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
                const callEvents = existing.filter(
                    (row) => row.kind === "callEvent",
                );
                const existingMessages = existing.filter(
                    (row): row is PslackTimelineMessageRow =>
                        row.kind === "message",
                );
                const mergedMessages = mergeTimelineMessagesWithGroupHistory(
                    existingMessages,
                    incoming,
                ).map(
                    (row) =>
                        ({
                            ...row,
                            kind: "message" as const,
                        }) satisfies PslackTimelineMessageRow,
                );
                return {
                    ...prev,
                    [spaceUuid]: sortTimelineRows([
                        ...callEvents,
                        ...mergedMessages,
                    ]),
                };
            });

            globalThis.setTimeout(
                () => flushPendingMessagesRef.current(),
                0,
            );
        },
        [],
    );

    const pushDmHistorySync = useCallback(
        async (spaceUuid: string, peerAccount: string) => {
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
                    bridge?.sendHistorySync(
                        spaceUuid,
                        peerAccount,
                        payload,
                    ) ?? false;
                if (!sent) {
                    enqueueHistorySyncPush(chain, self, {
                        peerAccount,
                        spaceUuid,
                        kind: "dm",
                        enqueuedAt: Date.now(),
                    });
                } else {
                    dequeueHistorySyncPush(
                        chain,
                        self,
                        peerAccount,
                        spaceUuid,
                        "dm",
                    );
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
        },
        [],
    );

    const pushGroupHistorySync = useCallback(
        async (spaceUuid: string, peerAccount: string) => {
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
                    bridge?.sendGroupHistorySync(
                        spaceUuid,
                        peerAccount,
                        payload,
                    ) ?? false;
                if (!sent) {
                    enqueueHistorySyncPush(chain, self, {
                        peerAccount,
                        spaceUuid,
                        kind: "group",
                        enqueuedAt: Date.now(),
                    });
                } else {
                    dequeueHistorySyncPush(
                        chain,
                        self,
                        peerAccount,
                        spaceUuid,
                        "group",
                    );
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
        },
        [],
    );

    const drainHistorySyncPushForPeer = useCallback(
        async (peerAccount: string) => {
            const self = selfRef.current;
            const chain = chainIdRef.current;
            if (!self || !chain) return;

            for (const record of historySyncPushForPeer(
                chain,
                self,
                peerAccount,
            )) {
                if (record.kind === "group") {
                    await pushGroupHistorySync(record.spaceUuid, peerAccount);
                } else {
                    await pushDmHistorySync(record.spaceUuid, peerAccount);
                }
            }
        },
        [pushDmHistorySync, pushGroupHistorySync],
    );

    const applyInboundDmDataChannelMessageRef = useRef(
        applyInboundDmDataChannelMessage,
    );
    applyInboundDmDataChannelMessageRef.current =
        applyInboundDmDataChannelMessage;

    const applyInboundGroupDataChannelMessageRef = useRef(
        applyInboundGroupDataChannelMessage,
    );
    applyInboundGroupDataChannelMessageRef.current =
        applyInboundGroupDataChannelMessage;

    const applyInboundDmHistorySyncRef = useRef(applyInboundDmHistorySync);
    applyInboundDmHistorySyncRef.current = applyInboundDmHistorySync;

    const applyInboundGroupHistorySyncRef = useRef(applyInboundGroupHistorySync);
    applyInboundGroupHistorySyncRef.current = applyInboundGroupHistorySync;

    const pushDmHistorySyncRef = useRef(pushDmHistorySync);
    pushDmHistorySyncRef.current = pushDmHistorySync;

    const pushGroupHistorySyncRef = useRef(pushGroupHistorySync);
    pushGroupHistorySyncRef.current = pushGroupHistorySync;

    const markDmPendingDelivered = useCallback(
        (clientMsgId: string, recipient: string, spaceId: string) => {
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
                const complete = cur.recipients.every((r) =>
                    deliveredTo.includes(r),
                );
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
                        (m) =>
                            m.kind === "message" &&
                            m.clientMsgId === clientMsgId,
                    );
                    if (ix < 0) continue;
                    const cur = prevList[ix] as PslackTimelineMessageRow;
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
                        (m) =>
                            m.kind === "message" &&
                            m.clientMsgId === clientMsgId,
                    );
                    if (ix >= 0) {
                        const cur = prevList[ix] as PslackTimelineMessageRow;
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
        },
        [replacePendingMessages, upsertPendingTimelineRow],
    );

    const markDmPendingDeliveredRef = useRef(markDmPendingDelivered);
    markDmPendingDeliveredRef.current = markDmPendingDelivered;

    const flushPendingMessages = useCallback(() => {
        transportBridgeRef.current?.messaging?.hydrateFromStorage();
    }, []);

    const flushPendingMessagesRef = useRef(flushPendingMessages);
    flushPendingMessagesRef.current = flushPendingMessages;

    const flushDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(
        null,
    );
    const schedulePendingFlush = useCallback(() => {
        if (leavingChatRef.current) return;
        flushPendingMessagesRef.current();
    }, []);

    const clearAvCallMedia = useCallback(() => {
        setAvCallLocalStream(null);
        setAvCallRemoteStream(null);
        setAvCallRemoteStreamsByAccount({});
        setAvCallAudioMuted(false);
        setAvCallVideoMuted(false);
        setAvCallRemoteAudioMuted(false);
        setAvCallRemoteVideoMuted(false);
        setAvCallRemoteAvStateByAccount({});
        setAvCallAudioOnlyFallback(false);
    }, []);

    const scheduleTerminalCallDismiss = useCallback(
        (match: { callId?: string; spaceUuid?: string }) => {
            if (terminalCallDismissTimerRef.current != null) {
                globalThis.clearTimeout(terminalCallDismissTimerRef.current);
            }
            terminalCallDismissTimerRef.current = globalThis.setTimeout(() => {
                terminalCallDismissTimerRef.current = null;
                setActiveCall((prev) => {
                    if (!prev) return prev;
                    if (match.callId && prev.callId !== match.callId) {
                        return prev;
                    }
                    if (
                        match.spaceUuid &&
                        prev.conversationId !== match.spaceUuid
                    ) {
                        return prev;
                    }
                    return null;
                });
                if (match.spaceUuid) {
                    avCallOrchestratorRef.current?.clearRun(match.spaceUuid);
                    if (avCallUiArmedRef.current === match.spaceUuid) {
                        avCallUiArmedRef.current = null;
                    }
                    clearAvCallMedia();
                }
            }, AV_CALL_TERMINAL_DISMISS_MS);
        },
        [clearAvCallMedia],
    );
    const scheduleTerminalCallDismissRef = useRef(scheduleTerminalCallDismiss);
    scheduleTerminalCallDismissRef.current = scheduleTerminalCallDismiss;

    const syncAvCallUiFromSnapshot = useCallback(
        (spaceUuid: string, snap: AvCallSessionSnapshot) => {
            const armed = avCallUiArmedRef.current;
            const active = activeCallRef.current;
            const showUi =
                armed === spaceUuid ||
                (active?.conversationId === spaceUuid &&
                    active.source === "av-call");

            if (snap.phase === "failed" || snap.phase === "idle") {
                if (ringOutTimerRef.current != null) {
                    globalThis.clearTimeout(ringOutTimerRef.current);
                    ringOutTimerRef.current = null;
                }
                void refreshObjectiveCallEventsForSpaceRef.current(spaceUuid);

                const terminalReason = snap.lastError ?? "";
                if (
                    showUi &&
                    snap.phase === "failed" &&
                    isAvCallTerminalReason(terminalReason)
                ) {
                    const lastFrame = avCallTerminalUiMessage(terminalReason);
                    clearAvCallMedia();
                    setActiveCall((prev) =>
                        prev?.conversationId === spaceUuid &&
                        prev.source === "av-call"
                            ? { ...prev, status: "ended", lastFrame }
                            : prev,
                    );
                    scheduleTerminalCallDismissRef.current({ spaceUuid });
                    return;
                }

                if (showUi && snap.phase === "failed" && snap.lastError) {
                    setLastInboundError(
                        avCallConnectivityErrorMessage(snap.lastError),
                    );
                }
                if (showUi) {
                    avCallUiArmedRef.current = null;
                    clearAvCallMedia();
                    setActiveCall((prev) =>
                        prev?.conversationId === spaceUuid &&
                        prev.source === "av-call"
                            ? null
                            : prev,
                    );
                    avCallOrchestratorRef.current?.clearRun(spaceUuid);
                }
                return;
            }

            if (!showUi) return;

            const self = selfRef.current;
            if (!self) return;

            const conversation = resolveConversationSync(spaceUuid);
            if (!conversation) return;

            const run = avCallOrchestratorRef.current?.getRun(spaceUuid);
            const wantVideo =
                run?.kind === "dm" || run?.kind === "group"
                    ? run.wantVideo
                    : true;
            const wantAudio =
                run?.kind === "dm" || run?.kind === "group"
                    ? run.wantAudio
                    : true;

            const sessionId = snap.sessionId;
            if (!sessionId) return;

            const isGroupSpace =
                conversation.kind === "group" &&
                conversation.members.length > 2;

            if (isGroupSpace) {
                const groupParticipants = buildGroupMeetParticipants(
                    conversation.members,
                    self,
                    presenceByAccountRef.current,
                    snap.meshPeerSignalingReady,
                    snap.phase,
                );
                const isConnected =
                    snap.phase === "ready" &&
                    anyGroupMeetJoined(snap.meshPeerSignalingReady);
                const anyParticipantJoined = groupParticipants.some(
                    (participant) => participant.status === "joined",
                );
                const isInProgress =
                    snap.phase === "ensuring" ||
                    snap.phase === "creating" ||
                    snap.phase === "joining" ||
                    snap.phase === "waiting-peer" ||
                    snap.phase === "signaling" ||
                    isConnected;

                if (!isInProgress) return;

                if (run?.kind === "group") {
                    setAvCallRemoteStreamsByAccount(
                        buildGroupMeetRemoteStreamMap(run.meshPeers),
                    );
                    if (run.localStream) {
                        setAvCallLocalStream(run.localStream);
                    }
                }

                setActiveCall((prev) => {
                    const direction =
                        prev?.conversationId === spaceUuid &&
                        prev.source === "av-call"
                            ? prev.direction
                            : avCallDirectionRef.current;
                    return {
                        callId: sessionId,
                        conversationId: spaceUuid,
                        peerAccount: groupMeetDisplayPeer(groupParticipants),
                        direction,
                        wantVideo,
                        wantAudio,
                        startedAt: prev?.startedAt ?? Date.now(),
                        status: isConnected ? "connected" : "ringing",
                        source: "av-call",
                        lastFrame: groupMeetStatusLabel(
                            groupParticipants,
                            snap.phase,
                            isConnected,
                        ),
                        callKind: "group",
                        groupParticipants,
                    };
                });

                if (
                    !isConnected &&
                    !anyParticipantJoined &&
                    avCallDirectionRef.current === "outgoing" &&
                    ringOutTimerRef.current == null
                ) {
                    ringOutTimerRef.current = globalThis.setTimeout(() => {
                        ringOutTimerRef.current = null;
                        avCallOrchestratorRef.current?.hangupAvCallSession(
                            spaceUuid,
                            "timeout",
                        );
                    }, 20_000);
                } else if (
                    (isConnected || anyParticipantJoined) &&
                    ringOutTimerRef.current != null
                ) {
                    globalThis.clearTimeout(ringOutTimerRef.current);
                    ringOutTimerRef.current = null;
                }
                return;
            }

            const peerAccount =
                conversation.kind === "dm" && conversation.members.length === 2
                    ? conversation.members.find((m) => m !== self)
                    : null;
            if (!peerAccount) return;

            const isConnected =
                snap.phase === "ready" && snap.mediaConnected === true;
            const isInProgress =
                snap.phase === "ensuring" ||
                snap.phase === "creating" ||
                snap.phase === "joining" ||
                snap.phase === "waiting-peer" ||
                snap.phase === "signaling" ||
                isConnected;

            if (!isInProgress) return;

            setActiveCall((prev) => {
                const direction =
                    prev?.conversationId === spaceUuid &&
                    prev.source === "av-call"
                        ? prev.direction
                        : avCallDirectionRef.current;
                return {
                    callId: sessionId,
                    conversationId: spaceUuid,
                    peerAccount,
                    direction,
                    wantVideo,
                    wantAudio,
                    startedAt: prev?.startedAt ?? Date.now(),
                    status: isConnected ? "connected" : "ringing",
                    source: "av-call",
                    lastFrame: isConnected
                        ? "Connected"
                        : avCallPhaseUiLabel(snap.phase),
                    callKind: "dm",
                };
            });

            if (
                !isConnected &&
                avCallDirectionRef.current === "outgoing" &&
                ringOutTimerRef.current == null
            ) {
                ringOutTimerRef.current = globalThis.setTimeout(() => {
                    ringOutTimerRef.current = null;
                    avCallOrchestratorRef.current?.hangupAvCallSession(
                        spaceUuid,
                        "timeout",
                    );
                }, 20_000);
            } else if (isConnected && ringOutTimerRef.current != null) {
                globalThis.clearTimeout(ringOutTimerRef.current);
                ringOutTimerRef.current = null;
            }
        },
        [clearAvCallMedia],
    );

    const handleAvCallMediaReady = useCallback(
        (
            spaceUuid: string,
            info: {
                peerAccount: string;
                localStream: MediaStream;
                remoteStream: MediaStream | null;
            },
        ) => {
            if (avCallUiArmedRef.current !== spaceUuid) return;
            const run = avCallOrchestratorRef.current?.getRun(spaceUuid);
            if (run?.kind === "dm") {
                setAvCallAudioOnlyFallback(
                    run.peer?.getVideoActuallyDisabled() ?? false,
                );
            } else if (run?.kind === "group") {
                setAvCallAudioOnlyFallback(
                    run.meshPeers
                        .get(info.peerAccount)
                        ?.getVideoActuallyDisabled() ?? false,
                );
            }
            setAvCallLocalStream(info.localStream);
            if (run?.kind === "group") {
                setAvCallRemoteStreamsByAccount(
                    buildGroupMeetRemoteStreamMap(run.meshPeers),
                );
                setAvCallRemoteStream(null);
            } else {
                setAvCallRemoteStream(info.remoteStream);
            }
            setActiveCall((prev) => {
                const conversation = conversationsRef.current.find(
                    (row) => row.conversationId === spaceUuid,
                );
                const self = selfRef.current;
                if (
                    run?.kind === "group" &&
                    conversation &&
                    self &&
                    conversation.members.length > 2
                ) {
                    const meshReady =
                        avCallOrchestratorRef.current?.getSnapshot(spaceUuid)
                            .meshPeerSignalingReady ?? {};
                    const groupParticipants = buildGroupMeetParticipants(
                        conversation.members,
                        self,
                        presenceByAccountRef.current,
                        meshReady,
                        run.snapshot.phase,
                    );
                    const isConnected = anyGroupMeetJoined(meshReady);
                    const direction =
                        prev?.conversationId === spaceUuid &&
                        prev.source === "av-call"
                            ? prev.direction
                            : avCallDirectionRef.current;
                    return {
                        callId: run.snapshot.sessionId ?? prev?.callId ?? "",
                        conversationId: spaceUuid,
                        peerAccount: groupMeetDisplayPeer(groupParticipants),
                        direction,
                        wantVideo: run.wantVideo,
                        wantAudio: run.wantAudio,
                        startedAt: prev?.startedAt ?? Date.now(),
                        status: isConnected ? "connected" : "ringing",
                        source: "av-call",
                        lastFrame: groupMeetStatusLabel(
                            groupParticipants,
                            run.snapshot.phase,
                            isConnected,
                        ),
                        callKind: "group",
                        groupParticipants,
                    };
                }
                if (
                    prev?.conversationId !== spaceUuid ||
                    prev.source !== "av-call"
                ) {
                    return prev;
                }
                const wantVideo =
                    run?.kind === "dm" || run?.kind === "group"
                        ? run.wantVideo
                        : prev.wantVideo;
                const wantAudio =
                    run?.kind === "dm" || run?.kind === "group"
                        ? run.wantAudio
                        : prev.wantAudio;
                return {
                    ...prev,
                    wantVideo,
                    wantAudio,
                    status: "connected",
                    lastFrame: "Connected",
                    callKind: "dm",
                };
            });
            if (ringOutTimerRef.current != null) {
                globalThis.clearTimeout(ringOutTimerRef.current);
                ringOutTimerRef.current = null;
            }
        },
        [],
    );

    const handleAvCallParticipantState = useCallback(
        (
            sessionId: string,
            participant: string,
            state: {
                audioMuted?: boolean;
                videoMuted?: boolean;
            },
        ) => {
            const self = selfRef.current;
            if (!self || participant === self) return;

            const run = avCallOrchestratorRef.current?.findRunBySessionId(
                sessionId,
            );
            if (!run) return;

            const spaceUuid = run.spaceUuid;
            const showUi =
                avCallUiArmedRef.current === spaceUuid ||
                (activeCallRef.current?.conversationId === spaceUuid &&
                    activeCallRef.current.source === "av-call");
            if (!showUi) return;

            if (run.kind === "group") {
                setAvCallRemoteAvStateByAccount((prev) => ({
                    ...prev,
                    [participant]: {
                        audioMuted:
                            state.audioMuted ?? prev[participant]?.audioMuted,
                        videoMuted:
                            state.videoMuted ?? prev[participant]?.videoMuted,
                    },
                }));
                return;
            }

            if (participant !== run.peerAccount) return;
            if (state.audioMuted != null) {
                setAvCallRemoteAudioMuted(state.audioMuted);
            }
            if (state.videoMuted != null) {
                setAvCallRemoteVideoMuted(state.videoMuted);
            }
        },
        [],
    );

    const sendAvCallParticipantState = useCallback(
        (audioMuted: boolean, videoMuted: boolean) => {
            const ac = activeCallRef.current;
            if (ac?.source !== "av-call" || ac.status !== "connected") return;
            const run = avCallOrchestratorRef.current?.getRun(ac.conversationId);
            const sessionId = run?.snapshot.sessionId;
            if (!run?.hasJoined || !sessionId) return;
            avCallOrchestratorRef.current
                ?.getSignaling()
                ?.participantState(sessionId, { audioMuted, videoMuted });
        },
        [],
    );

    syncAvCallUiRef.current = syncAvCallUiFromSnapshot;
    onAvCallMediaReadyRef.current = handleAvCallMediaReady;
    onAvCallParticipantStateRef.current = handleAvCallParticipantState;

    const drainHistorySyncPushForPeerRef = useRef(drainHistorySyncPushForPeer);
    drainHistorySyncPushForPeerRef.current = drainHistorySyncPushForPeer;

    useEffect(() => {
        if (!contactsLoaded || !selfAccount) return;
        transportBridgeRef.current?.flushDeferredInboundAcceptance(
            (record) => {
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
                    return applyInboundGroupDataChannelMessageRef.current(
                        envelope,
                    );
                }
                return applyInboundDmDataChannelMessageRef.current(envelope);
            },
        );
        globalThis.setTimeout(
            () => flushPendingMessagesRef.current(),
            0,
        );
    }, [contactsLoaded, selfAccount]);

    useEffect(() => {
        if (!webrtcClient) return;

        const unregisterHandlers = registerHandlers({
            welcome: (frame) => {
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
                    if (
                        conv.kind === "group" &&
                        conv.members.length > 2
                    ) {
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
                        recordChurnTrace("ws-welcome-no-selected-conversation", {
                            selected,
                            conversationKind: conversation?.kind ?? null,
                        });
                    }
                }
                void loadObjectiveSpacesRef.current();
                globalThis.setTimeout(
                    () => flushPendingMessagesRef.current(),
                    0,
                );
            },
            presenceSnapshot: (frame) => {
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
                        const spaceId = spaceUuidFromPslackConversationId(
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
            presence: (frame) => {
                const self = selfRef.current;
                if (self && frame.account === self) return;
                if (!shouldAcceptInboundFrom(frame.account)) return;
                const nextStatus: PresenceUi =
                    frame.status === "online" ? "online" : "offline";
                const wasOnline =
                    presenceByAccountRef.current[frame.account] ===
                    "online";
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
                            const spaceId =
                                spaceUuidFromPslackConversationId(
                                    pending.conversationId,
                                );
                            const conversation =
                                conversationsRef.current.find(
                                    (row) =>
                                        row.conversationId === spaceId,
                                );
                            const dmMembers =
                                conversation?.members ??
                                canonicalDmMembers(
                                    self,
                                    pending.recipients,
                                );
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
                    transportBridgeRef.current?.onPeerOnline(
                        frame.account,
                    );
                    avCallOrchestratorRef.current?.onPeerOnline(
                        frame.account,
                    );
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
                    transportBridgeRef.current?.onPeerOffline(
                        frame.account,
                    );
                    avCallOrchestratorRef.current?.onPeerOffline(
                        frame.account,
                    );
                }
            },
            error: (frame) => {
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
                return applyInboundDmDataChannelMessageRef.current(envelope);
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
            () => transportBridgeRef.current?.peerRegistry ?? null,
            () => transportBridgeRef.current?.signaling ?? null,
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
            avCallOrchestratorRef.current?.dispose();
            avCallOrchestratorRef.current = null;
            setIncomingAvCallInvite(null);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- chat handlers read latest state via refs
    }, [
        webrtcClient,
        registerHandlers,
        markSignalingTeardown,
    ]);

    const pendingDeliveryCount = useMemo(
        () =>
            Object.values(pendingMessages).filter(
                (row) => row.status === "pending",
            ).length,
        [pendingMessages],
    );

    useEffect(() => {
        if (pendingDeliveryCount === 0) return;
        schedulePendingFlush();
        return () => {
            if (flushDebounceRef.current != null) {
                clearTimeout(flushDebounceRef.current);
            }
        };
    }, [
        schedulePendingFlush,
        pendingDeliveryCount,
        connectionState,
        presenceReady,
    ]);

    const scheduleDmChatDataSession = useCallback(
        (spaceUuid: string, members: readonly string[]) => {
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
            transportBridgeRef.current?.ensureChatDataSession(
                spaceUuid,
                members,
            );
        },
        [],
    );

    const scheduleGroupChatDataSession = useCallback(
        (spaceUuid: string, members: readonly string[]) => {
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
            transportBridgeRef.current?.ensureChatDataSession(
                spaceUuid,
                members,
            );
        },
        [],
    );

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
        if (
            conversation?.kind === "dm" &&
            conversation.members.length === 2
        ) {
            scheduleDmChatDataSession(
                conversation.conversationId,
                conversation.members,
            );
            return;
        }

        if (
            conversation?.kind === "group" &&
            conversation.members.length > 2
        ) {
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

        const spaceId = spaceUuidFromPslackConversationId(
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

    const releaseIdleChatDataForSelection = useCallback(() => {
        const bridge = transportBridgeRef.current;
        if (!bridge) return;
        const self = selfRef.current;
        if (!self) return;
        const selected = selectedConversationIdRef.current;
        const keepPeers = new Set<string>();
        if (selected) {
            const conv = conversationsRef.current.find(
                (row) => row.conversationId === selected,
            );
            for (const member of conv?.members ?? []) {
                if (member !== self) keepPeers.add(member);
            }
        }
        for (const row of Object.values(pendingMessagesRef.current)) {
            if (row.status !== "pending") continue;
            for (const recipient of row.recipients) {
                keepPeers.add(recipient);
            }
        }
        void keepPeers;
    }, []);

    const location = useLocation();
    const onChatRoute =
        location.pathname === "/chat" ||
        location.pathname.startsWith("/chat/");

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
        avCallOrchestratorRef.current?.dispose();
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
        avCallOrchestratorRef.current?.dispose();
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
    }, [
        onChatRoute,
        teardownChatRealtime,
        location.pathname,
    ]);

    useEffect(() => {
        if (!contactsLoaded) return;
        transportBridgeRef.current?.setFocusedSpace(
            selectedConversationId,
        );
        releaseIdleChatDataForSelection();
    }, [
        contactsLoaded,
        pendingDeliveryCount,
        releaseIdleChatDataForSelection,
        selectedConversationId,
    ]);

    const reconnectNow = useCallback(() => {
        reconnectWebRtcSession();
    }, [reconnectWebRtcSession]);

    const openOrFocusDm = useCallback((otherAccount: string) => {
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
            setSelectedConversationId(existing.conversationId, "openOrFocusDm-existing");
        } else {
            pendingDmMemberRef.current = otherAccount;
            setComposePendingDmPeer(otherAccount);
            recordThreadLifecycle("compose-wake", {
                mode: "pending-peer",
                peer: otherAccount,
            });
            composeTimingLog("openOrFocusDm-pending-peer", { peer: otherAccount });
        }

        setLastInboundError(null);

        void (async () => {
            try {
                await ensureDm(otherAccount);
                await loadObjectiveSpaces();
            } catch (e) {
                const detail =
                    e instanceof Error
                        ? e.message
                        : "Could not create DM space.";
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
    }, [loadObjectiveSpaces]);

    /**
     * Open a group chat: `others` must be **other** accounts only (not the current user).
     * Server requires at least two distinct others (≥3 members including self).
     */
    const openGroupChat = useCallback(
        async (otherAccounts: readonly string[]) => {
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
                transportBridgeRef.current?.notifySpaceMembershipHint(
                    uniqueOthers,
                );
            } catch (e) {
                pendingGroupKeyRef.current = null;
                const detail =
                    e instanceof Error
                        ? e.message
                        : "Could not create group space.";
                setLastInboundError(detail);
                return;
            }

            selectSpaceByMembers([self, ...uniqueOthers]);
            setLastInboundError(null);
        },
        [loadObjectiveSpaces, selectSpaceByMembers],
    );

    const enqueueOutboundChatMessage = useCallback(
        (
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
                conversationId: pslackConversationIdFromSpaceUuid(convId),
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
            } else if (
                !persistPendingMessages(pendingMessagesRef.current)
            ) {
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
        },
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
        (body: string) => {
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

            let conversation = convId
                ? resolveConversationForSend(convId)
                : undefined;

            let recipients: string[] = [];
            let dmMembers: [string, string] | null = null;

            if (
                conversation?.kind === "dm" &&
                conversation.members.length === 2
            ) {
                dmMembers = [conversation.members[0], conversation.members[1]];
                recipients = conversation.members.filter(
                    (member) => member !== from,
                );
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
                recipients = conversation.members.filter(
                    (member) => member !== from,
                );
            } else {
                composeTimingLog("sendChatMessage-abort", {
                    reason: "no-conversation-or-recipients",
                    convId: convId ? shortSpaceId(convId) : undefined,
                    pendingPeer,
                });
                return;
            }

            const dmSendIntent =
                dmMembers !== null && recipients.length === 1;
            const selectedIsDm =
                conversation?.kind === "dm" &&
                conversation.members.length === 2;

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

            const needsDerivedDmSpace =
                dmSendIntent && (!selectedIsDm || !convId);

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
                        (await deriveSpaceUuidForCanonicalMembers(
                            sendDmMembers,
                        ));
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

            const outboundSpaceId =
                convId ?? conversation?.conversationId ?? undefined;

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
        },
        [
            composePendingDmPeer,
            enqueueOutboundChatMessage,
            loadObjectiveSpaces,
            resolveConversationSync,
            selectedConversationId,
            setSelectedConversationId,
        ],
    );


    const startMeetCall = useCallback(() => {
        const self = selfRef.current;
        if (!self) return;

        const orch = avCallOrchestratorRef.current;
        if (!orch) return;

        void (async () => {
            let convId = selectedConversationId;
            let conversation = convId
                ? resolveConversationSync(convId)
                : undefined;

            const pendingPeer = composePendingDmPeerRef.current;
            if (
                !conversation &&
                pendingPeer &&
                pendingPeer !== self
            ) {
                try {
                    await ensureDm(pendingPeer);
                    await loadObjectiveSpaces();
                    conversation = findVisibleDmWithPeer(
                        pendingPeer,
                        self,
                        objectiveSpacesRef.current,
                        contactAccountsRef.current,
                        contactsLoadedRef.current,
                    );
                    if (conversation) {
                        convId = conversation.conversationId;
                        pendingDmMemberRef.current = null;
                        setComposePendingDmPeer(null);
                        setSelectedConversationId(
                            convId,
                            "startMeetCall-ensureDm",
                        );
                    }
                } catch (e) {
                    const detail =
                        e instanceof Error
                            ? e.message
                            : "Could not create DM space for Meet.";
                    setLastInboundError(detail);
                    return;
                }
            }

            if (!convId || !conversation || !conversation.members.includes(self)) {
                return;
            }

            avCallDirectionRef.current = "outgoing";
            avCallUiArmedRef.current = convId;
            setSelectedConversationId(convId);

            if (
                conversation.kind === "dm" &&
                conversation.members.length === 2
            ) {
                orch.ensureDmAvCallSession(convId, conversation.members);
                return;
            }

            if (
                conversation.kind === "group" &&
                conversation.members.length > 2
            ) {
                orch.ensureGroupAvCallSession(convId, conversation.members);
            }
        })();
    }, [
        loadObjectiveSpaces,
        resolveConversationSync,
        selectedConversationId,
        setSelectedConversationId,
    ]);

    const startMockCall = useCallback(() => {
        const convId = selectedConversationId;
        const self = selfRef.current;
        if (!convId || !self) return;

        const conversation = conversationsRef.current.find(
            (c) => c.conversationId === convId,
        );
        if (
            !conversation ||
            conversation.kind !== "dm" ||
            conversation.members.length !== 2 ||
            !conversation.members.includes(self)
        ) {
            return;
        }

        const peerAccount = conversation.members.find((m) => m !== self);
        if (!peerAccount) return;

        setActiveCall({
            callId: `mock-${crypto.randomUUID()}`,
            conversationId: convId,
            peerAccount,
            direction: "outgoing",
            wantVideo: true,
            wantAudio: true,
            startedAt: Date.now(),
            status: "ringing",
            source: "mock",
            lastFrame: "Mock outgoing call preview",
        });
    }, [selectedConversationId]);

    const acceptIncomingCall = useCallback(() => {
        const avInvite = avCallOrchestratorRef.current?.getPendingInvite();
        if (avInvite) {
            void (async () => {
                const self = selfRef.current;
                if (
                    self &&
                    needsSpaceReloadForAvCallInvite(
                        avInvite.spaceUuid,
                        self,
                        objectiveSpacesRef.current,
                        contactAccountsRef.current,
                        contactsLoadedRef.current,
                    )
                ) {
                    try {
                        await loadObjectiveSpaces();
                    } catch {
                        /* accept still proceeds; UI may catch up on next refresh */
                    }
                }

                avCallDirectionRef.current = "incoming";
                avCallUiArmedRef.current = avInvite.spaceUuid;
                avCallOrchestratorRef.current?.acceptIncomingInvite();
                setIncomingAvCallInvite(null);
                setSelectedConversationId(avInvite.spaceUuid);
                const isGroupInvite =
                    (avInvite.participants?.length ?? 0) > 2 &&
                    !!self &&
                    !!avInvite.participants;
                const groupParticipants = isGroupInvite
                    ? buildGroupMeetParticipants(
                          avInvite.participants!,
                          self!,
                          presenceByAccountRef.current,
                          {},
                          "signaling",
                      )
                    : undefined;
                setActiveCall({
                    callId: avInvite.sessionId,
                    conversationId: avInvite.spaceUuid,
                    peerAccount: isGroupInvite
                        ? groupMeetDisplayPeer(groupParticipants!)
                        : avInvite.from,
                    direction: "incoming",
                    wantVideo: avInvite.wantVideo,
                    wantAudio: avInvite.wantAudio,
                    startedAt: Date.now(),
                    status: "ringing",
                    source: "av-call",
                    lastFrame: isGroupInvite
                        ? groupMeetStatusLabel(
                              groupParticipants!,
                              "signaling",
                              false,
                          )
                        : "Connecting…",
                    callKind: isGroupInvite ? "group" : "dm",
                    groupParticipants,
                });
            })();
            return;
        }
    }, [loadObjectiveSpaces, setSelectedConversationId]);

    const declineIncomingCall = useCallback(
        (reason: "user" | "timeout") => {
            const avInvite = avCallOrchestratorRef.current?.getPendingInvite();
            if (avInvite) {
                avCallOrchestratorRef.current?.declineIncomingInvite(reason);
                setIncomingAvCallInvite(null);
                return;
            }
            setIncomingCall(null);
        },
        [],
    );

    const endPlaceholderCall = useCallback(() => {
        if (ringOutTimerRef.current != null) {
            globalThis.clearTimeout(ringOutTimerRef.current);
            ringOutTimerRef.current = null;
        }
        const ac = activeCallRef.current;
        if (!ac) return;
        if (hangupInitiatedCallIdRef.current === ac.callId) return;
        hangupInitiatedCallIdRef.current = ac.callId;

        if (ac.source === "av-call") {
            const reason =
                ac.status === "ringing" && ac.direction === "outgoing"
                    ? "cancelled"
                    : "ended";
            avCallOrchestratorRef.current?.hangupAvCallSession(
                ac.conversationId,
                reason,
            );
            avCallUiArmedRef.current = null;
            clearAvCallMedia();
            void refreshObjectiveCallEventsForSpaceRef.current(
                ac.conversationId,
            );
        } else {
            setLastInboundError(null);
        }
        setActiveCall(null);
    }, [clearAvCallMedia, markSignalingTeardown]);

    const toggleAvCallAudioMuted = useCallback(() => {
        const ac = activeCallRef.current;
        const run =
            ac?.source === "av-call"
                ? avCallOrchestratorRef.current?.getRun(ac.conversationId)
                : undefined;
        if (!run) return;
        const next = !avCallAudioMutedRef.current;
        const enabled = !next;
        if (run.kind === "group") {
            if (run.localStream) {
                for (const track of run.localStream.getAudioTracks()) {
                    track.enabled = enabled;
                }
            }
            for (const peer of run.meshPeers.values()) {
                peer.setAudioEnabled(enabled);
            }
        } else if (run.peer) {
            run.peer.setAudioEnabled(enabled);
        }
        setAvCallAudioMuted(next);
        sendAvCallParticipantState(next, avCallVideoMutedRef.current);
    }, [sendAvCallParticipantState]);

    const toggleAvCallVideoMuted = useCallback(() => {
        const ac = activeCallRef.current;
        const run =
            ac?.source === "av-call"
                ? avCallOrchestratorRef.current?.getRun(ac.conversationId)
                : undefined;
        if (!run) return;
        const next = !avCallVideoMutedRef.current;
        const enabled = !next;
        if (run.kind === "group") {
            if (run.localStream) {
                for (const track of run.localStream.getVideoTracks()) {
                    track.enabled = enabled;
                }
            }
            for (const peer of run.meshPeers.values()) {
                peer.setVideoEnabled(enabled);
            }
        } else if (run.peer) {
            run.peer.setVideoEnabled(enabled);
        }
        setAvCallVideoMuted(next);
        sendAvCallParticipantState(avCallAudioMutedRef.current, next);
    }, [sendAvCallParticipantState]);

    const uiCallLocalStream = avCallLocalStream;
    const uiCallRemoteStream = avCallRemoteStream;
    const uiCallRemoteStreamsByAccount =
        activeCall?.source === "av-call" && activeCall.callKind === "group"
            ? avCallRemoteStreamsByAccount
            : undefined;
    const uiCallAudioMuted = avCallAudioMuted;
    const uiCallVideoMuted = avCallVideoMuted;
    const uiCallRemoteAudioMuted =
        activeCall?.source === "av-call" && activeCall.callKind === "group"
            ? false
            : avCallRemoteAudioMuted;
    const uiCallRemoteVideoMuted =
        activeCall?.source === "av-call" && activeCall.callKind === "group"
            ? false
            : avCallRemoteVideoMuted;
    const uiCallRemoteAvStateByAccount =
        activeCall?.source === "av-call" && activeCall.callKind === "group"
            ? avCallRemoteAvStateByAccount
            : undefined;
    const uiCallAudioOnlyFallback = avCallAudioOnlyFallback;
    const uiToggleCallAudioMuted = toggleAvCallAudioMuted;
    const uiToggleCallVideoMuted = toggleAvCallVideoMuted;

    const authLost = useMemo(() => {
        const e = lastRealtimeError ?? "";
        return (
            /\b401\b/.test(e) ||
            e.toLowerCase().includes("unauthorized") ||
            e.toLowerCase().includes("/login failed")
        );
    }, [lastRealtimeError]);

    const chatTransportReady =
        connectionState === "connected" && presenceReady;

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
            conversations.find((c) => c.conversationId === selectedConversationId),
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
        if (authLost) return "Session expired — refresh the page to sign in again.";
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
            const registry = transportBridgeRef.current?.peerRegistry;
            if (!registry) {
                setThreadPeersUsable(false);
                return;
            }
            const rows = peerStatesForRemotes(
                threadRemoteRecipients,
                (remote) => registry.getState(remote),
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
            setThreadPeersUsable(
                rows.every((row) => row.state === "usable"),
            );
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
            const registry = transportBridgeRef.current?.peerRegistry;
            recordThreadLifecycle("establishing-start", {
                recipients: threadRemoteRecipients,
                peerStates: registry
                    ? peerStatesForRemotes(
                          threadRemoteRecipients,
                          (remote) => registry.getState(remote),
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
            const registry = transportBridgeRef.current?.peerRegistry;
            recordThreadLifecycle("mesh-live", {
                recipients: threadRemoteRecipients,
                peerStates: registry
                    ? peerStatesForRemotes(
                          threadRemoteRecipients,
                          (remote) => registry.getState(remote),
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
            const spaceId = spaceUuidFromPslackConversationId(
                pending.conversationId,
            );
            counts[spaceId] = (counts[spaceId] ?? 0) + count;
        }
        return counts;
    }, [pendingMessages]);

    const selectedHasPendingMessages =
        !!selectedConversationId &&
        (undeliveredByConversation[selectedConversationId] ?? 0) > 0;

    const incomingCallForDialog = useMemo((): PslackIncomingCall | null => {
        if (incomingCall) return incomingCall;
        if (!incomingAvCallInvite || !selfAccount) return null;
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
    }, [incomingCall, incomingAvCallInvite, selfAccount]);

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
            const registry = transportBridgeRef.current?.peerRegistry;
            const peerStates = registry
                ? peerStatesForRemotes(
                      threadRemoteRecipients,
                      (remote) => registry.getState(remote),
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
                realtimeReady: realtimeClientRef.current?.isSessionReady ?? null,
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
