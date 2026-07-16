import {
    type MutableRefObject,
    useCallback,
    useEffect,
    useRef,
    useState,
} from "react";

import type { PresenceUi } from "../../lib/chat-timeline-types";
import type { ConversationSnapshot } from "../../lib/protocol";
import type { GraphqlSpaceEntry } from "../../lib/space-bridge";
import type { GroupMeetLifecycleBySpace } from "../../lib/group-meet-lifecycle-ui";

import {
    type AvCallIncomingInvite,
    AvCallSessionOrchestrator,
    type AvCallSessionSnapshot,
} from "../../lib/av-call-session-orchestrator";
import type { GroupMeetParticipant } from "../../lib/group-meet-ui-state";
import { markVoluntaryGroupMeetLeave } from "../../lib/group-meet-voluntary-leave";
import type { ActiveCall, IncomingCall } from "./chat-socket-types";
import { createEndPlaceholderCall } from "./meet-session-end-action";
import {
    createAcceptIncomingCall,
    createDeclineIncomingCall,
    createRejoinGroupMeetCall,
} from "./meet-session-invite-actions";
import {
    createHandleAvCallMediaReady,
    createHandleAvCallParticipantState,
} from "./meet-session-media-ready";
import {
    createSendAvCallParticipantState,
    createToggleAvCallAudioMuted,
    createToggleAvCallVideoMuted,
} from "./meet-session-mute-actions";
import { createStartMeetCall, createStartMockCall } from "./meet-session-start-actions";
import { createSyncAvCallUiFromSnapshot } from "./meet-session-ui-sync";

/** Cleared-call IDs — suppress spurious `bad-call` from late signaling after teardown (decline, hangup, etc.). */
const AV_CALL_TERMINAL_DISMISS_MS = 2_500;

export type UseMeetSessionParams = {
    selfRef: MutableRefObject<string | null>;
    avCallOrchestratorRef: MutableRefObject<AvCallSessionOrchestrator | null>;
    conversationsRef: MutableRefObject<ConversationSnapshot[]>;
    objectiveSpacesRef: MutableRefObject<GraphqlSpaceEntry[]>;
    contactAccountsRef: MutableRefObject<Set<string>>;
    contactsLoadedRef: MutableRefObject<boolean>;
    presenceByAccountRef: MutableRefObject<Record<string, PresenceUi>>;
    selectedConversationId: string | undefined;
    setSelectedConversationId: (
        id: string | undefined,
        source?: string,
    ) => void;
    composePendingDmPeerRef: MutableRefObject<string | null>;
    setComposePendingDmPeer: (value: string | null) => void;
    pendingDmMemberRef: MutableRefObject<string | null>;
    resolveConversationSync: (
        spaceUuid: string,
    ) => ConversationSnapshot | undefined;
    loadObjectiveSpaces: () => Promise<GraphqlSpaceEntry[]>;
    setLastInboundError: (value: string | null) => void;
    refreshObjectiveCallEventsForSpaceRef: MutableRefObject<
        (spaceUuid: string) => Promise<void>
    >;
};

export type UseMeetSessionResult = {
    incomingCall: IncomingCall | null;
    activeCall: ActiveCall | null;
    activeCallRef: MutableRefObject<ActiveCall | null>;
    incomingCallRef: MutableRefObject<IncomingCall | null>;
    incomingAvCallInvite: AvCallIncomingInvite | null;
    setIncomingAvCallInvite: (invite: AvCallIncomingInvite | null) => void;
    groupMeetRejoinHint: {
        spaceUuid: string;
        sessionId: string;
        joinedCount: number;
    } | null;
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
    startMeetCall: () => void;
    startMockCall: () => void;
    acceptIncomingCall: () => void;
    declineIncomingCall: (reason: "user" | "timeout") => void;
    rejoinGroupMeetCall: (spaceUuid: string) => void;
    endPlaceholderCall: () => void;
    requestVoluntaryMeetLeave: () => void;
    callLocalStream: MediaStream | null;
    callRemoteStream: MediaStream | null;
    callRemoteStreamsByAccount: Record<string, MediaStream | null> | undefined;
    callAudioMuted: boolean;
    callVideoMuted: boolean;
    callRemoteAudioMuted: boolean;
    callRemoteVideoMuted: boolean;
    callRemoteAvStateByAccount:
        | Record<string, { audioMuted?: boolean; videoMuted?: boolean }>
        | undefined;
    callAudioOnlyFallback: boolean;
    toggleCallAudioMuted: () => void;
    toggleCallVideoMuted: () => void;
};

/**
 * Meet (av-call) UI session state and actions — Meet orchestration is kept
 * separate from messaging/pending-flush concerns. Talks to
 * `AvCallSessionOrchestrator` via refs owned by the transport-lifecycle
 * module (constructed once realtime + bridge are ready).
 *
 * This composition root owns all React state/refs; the actual action and
 * snapshot-sync logic lives in `meet-session-actions.ts` and
 * `meet-session-ui-sync.ts` as plain functions taking an explicit deps bag,
 * so this file stays focused on wiring.
 */
export function useMeetSession(
    params: UseMeetSessionParams,
): UseMeetSessionResult {
    const {
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
    } = params;

    const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(
        null,
    );
    const [activeCall, setActiveCall] = useState<ActiveCall | null>(null);
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

    const [incomingAvCallInvite, setIncomingAvCallInvite] =
        useState<AvCallIncomingInvite | null>(null);
    const [groupMeetRejoinHint, setGroupMeetRejoinHint] = useState<{
        spaceUuid: string;
        sessionId: string;
        joinedCount: number;
    } | null>(null);
    const groupMeetRejoinHintRef = useRef(groupMeetRejoinHint);
    groupMeetRejoinHintRef.current = groupMeetRejoinHint;

    const incomingCallRef = useRef<IncomingCall | null>(null);
    incomingCallRef.current = incomingCall;

    const activeCallRef = useRef<ActiveCall | null>(null);
    activeCallRef.current = activeCall;

    const hangupInitiatedCallIdRef = useRef<string | null>(null);
    /** Space whose av-call hangup is in flight — blocks snapshot UI re-arm. */
    const hangupInProgressSpaceRef = useRef<string | null>(null);
    if (!activeCall && !hangupInProgressSpaceRef.current) {
        hangupInitiatedCallIdRef.current = null;
    }

    /** Group Meet local UI lifecycle per space — blocks re-arm after voluntary leave. */
    const groupMeetLifecycleRef = useRef<GroupMeetLifecycleBySpace>({});
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

    const SIGNALING_TEARDOWN_SUPPRESS_MS = 12_000;
    const markSignalingTeardown = useCallback((callId: string | undefined) => {
        if (!callId) return;
        recentSignalingTeardownIdsRef.current.add(callId);
        globalThis.setTimeout(() => {
            recentSignalingTeardownIdsRef.current.delete(callId);
        }, SIGNALING_TEARDOWN_SUPPRESS_MS);
    }, []);

    const ringOutTimerRef = useRef<ReturnType<
        typeof globalThis.setTimeout
    > | null>(null);
    /** Group calls that have had at least one remote mesh join — suppress re-ring timeout. */
    const groupMeetEverJoinedRef = useRef<Set<string>>(new Set());
    const terminalCallDismissTimerRef = useRef<ReturnType<
        typeof globalThis.setTimeout
    > | null>(null);

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
                    // Only dismiss the terminal frame — leave a revived call alone.
                    if (prev.status !== "ended") return prev;
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
        createSyncAvCallUiFromSnapshot({
            selfRef,
            avCallOrchestratorRef,
            conversationsRef,
            presenceByAccountRef,
            resolveConversationSync,
            setLastInboundError,
            refreshObjectiveCallEventsForSpaceRef,
            activeCallRef,
            setActiveCall,
            avCallUiArmedRef,
            avCallDirectionRef,
            hangupInProgressSpaceRef,
            groupMeetRejoinHintRef,
            setGroupMeetRejoinHint,
            groupMeetLifecycleRef,
            groupMeetEverJoinedRef,
            ringOutTimerRef,
            scheduleTerminalCallDismissRef,
            clearAvCallMedia,
            setAvCallLocalStream,
            setAvCallRemoteStreamsByAccount,
        }),
        [clearAvCallMedia, resolveConversationSync, setLastInboundError],
    );

    const handleAvCallMediaReady = useCallback(
        createHandleAvCallMediaReady({
            avCallOrchestratorRef,
            hangupInProgressSpaceRef,
            groupMeetLifecycleRef,
            activeCallRef,
            avCallUiArmedRef,
            avCallDirectionRef,
            setAvCallAudioOnlyFallback,
            setAvCallLocalStream,
            setAvCallRemoteStreamsByAccount,
            setAvCallRemoteStream,
            setActiveCall,
            conversationsRef,
            selfRef,
            presenceByAccountRef,
            ringOutTimerRef,
        }),
        [],
    );

    const handleAvCallParticipantState = useCallback(
        createHandleAvCallParticipantState({
            selfRef,
            avCallOrchestratorRef,
            activeCallRef,
            avCallUiArmedRef,
            setAvCallRemoteAvStateByAccount,
            setAvCallRemoteAudioMuted,
            setAvCallRemoteVideoMuted,
        }),
        [],
    );

    const sendAvCallParticipantState = useCallback(
        createSendAvCallParticipantState({
            activeCallRef,
            avCallOrchestratorRef,
        }),
        [],
    );

    syncAvCallUiRef.current = syncAvCallUiFromSnapshot;
    onAvCallMediaReadyRef.current = handleAvCallMediaReady;
    onAvCallParticipantStateRef.current = handleAvCallParticipantState;

    const rejoinGroupMeetCallRef = useRef<(spaceUuid: string) => void>(
        () => {},
    );

    const startMeetCall = useCallback(
        createStartMeetCall({
            selfRef,
            avCallOrchestratorRef,
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
            avCallDirectionRef,
            avCallUiArmedRef,
            groupMeetLifecycleRef,
            groupMeetRejoinHintRef,
            setGroupMeetRejoinHint,
            setActiveCall,
            rejoinGroupMeetCallRef,
        }),
        [
            loadObjectiveSpaces,
            resolveConversationSync,
            selectedConversationId,
            setSelectedConversationId,
        ],
    );

    const startMockCall = useCallback(
        createStartMockCall({
            selectedConversationId,
            selfRef,
            conversationsRef,
            setActiveCall,
        }),
        [selectedConversationId],
    );

    const acceptIncomingCall = useCallback(
        createAcceptIncomingCall({
            avCallOrchestratorRef,
            avCallDirectionRef,
            avCallUiArmedRef,
            setIncomingAvCallInvite,
            selfRef,
            objectiveSpacesRef,
            contactAccountsRef,
            contactsLoadedRef,
            loadObjectiveSpaces,
            setSelectedConversationId,
            presenceByAccountRef,
            setActiveCall,
        }),
        [loadObjectiveSpaces, setSelectedConversationId],
    );

    const declineIncomingCall = useCallback(
        createDeclineIncomingCall({
            avCallOrchestratorRef,
            avCallUiArmedRef,
            setIncomingAvCallInvite,
            activeCallRef,
            setIncomingCall,
        }),
        [],
    );

    const rejoinGroupMeetCall = useCallback(
        createRejoinGroupMeetCall({
            selfRef,
            avCallOrchestratorRef,
            conversationsRef,
            setGroupMeetRejoinHint,
            groupMeetRejoinHintRef,
            groupMeetLifecycleRef,
            avCallDirectionRef,
            avCallUiArmedRef,
            setSelectedConversationId,
            setActiveCall,
            presenceByAccountRef,
        }),
        [setSelectedConversationId],
    );
    rejoinGroupMeetCallRef.current = rejoinGroupMeetCall;

    const endPlaceholderCallRef = useRef<() => void>(() => {});

    const endPlaceholderCall = useCallback(
        createEndPlaceholderCall({
            ringOutTimerRef,
            activeCallRef,
            selfRef,
            avCallOrchestratorRef,
            hangupInitiatedCallIdRef,
            hangupInProgressSpaceRef,
            groupMeetLifecycleRef,
            conversationsRef,
            avCallUiArmedRef,
            setActiveCall,
            setGroupMeetRejoinHint,
            clearAvCallMedia,
            refreshObjectiveCallEventsForSpaceRef,
            setLastInboundError,
        }),
        [clearAvCallMedia, markSignalingTeardown],
    );
    endPlaceholderCallRef.current = endPlaceholderCall;

    const requestVoluntaryMeetLeave = useCallback(() => {
        const self = selfRef.current;
        if (self) markVoluntaryGroupMeetLeave(self);
        endPlaceholderCallRef.current();
    }, []);

    useEffect(() => {
        if (typeof globalThis.window === "undefined") return;
        (
            globalThis as typeof globalThis & {
                __psibaseMeetE2e?: {
                    leaveActiveCall: () => void;
                    self: () => string | null;
                };
            }
        ).__psibaseMeetE2e = {
            leaveActiveCall: () => {
                const self = selfRef.current;
                if (self) markVoluntaryGroupMeetLeave(self);
                endPlaceholderCallRef.current();
            },
            self: () => selfRef.current,
        };
    }, []);

    const toggleAvCallAudioMuted = useCallback(
        createToggleAvCallAudioMuted({
            activeCallRef,
            avCallOrchestratorRef,
            avCallAudioMutedRef,
            avCallVideoMutedRef,
            setAvCallAudioMuted,
            setAvCallVideoMuted,
            sendAvCallParticipantState,
        }),
        [sendAvCallParticipantState],
    );

    const toggleAvCallVideoMuted = useCallback(
        createToggleAvCallVideoMuted({
            activeCallRef,
            avCallOrchestratorRef,
            avCallAudioMutedRef,
            avCallVideoMutedRef,
            setAvCallAudioMuted,
            setAvCallVideoMuted,
            sendAvCallParticipantState,
        }),
        [sendAvCallParticipantState],
    );

    const callRemoteStreamsByAccount =
        activeCall?.source === "av-call" && activeCall.callKind === "group"
            ? avCallRemoteStreamsByAccount
            : undefined;
    const callRemoteAudioMuted =
        activeCall?.source === "av-call" && activeCall.callKind === "group"
            ? false
            : avCallRemoteAudioMuted;
    const callRemoteVideoMuted =
        activeCall?.source === "av-call" && activeCall.callKind === "group"
            ? false
            : avCallRemoteVideoMuted;
    const callRemoteAvStateByAccount =
        activeCall?.source === "av-call" && activeCall.callKind === "group"
            ? avCallRemoteAvStateByAccount
            : undefined;

    return {
        incomingCall,
        activeCall,
        activeCallRef,
        incomingCallRef,
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
        callLocalStream: avCallLocalStream,
        callRemoteStream: avCallRemoteStream,
        callRemoteStreamsByAccount,
        callAudioMuted: avCallAudioMuted,
        callVideoMuted: avCallVideoMuted,
        callRemoteAudioMuted,
        callRemoteVideoMuted,
        callRemoteAvStateByAccount,
        callAudioOnlyFallback: avCallAudioOnlyFallback,
        toggleCallAudioMuted: toggleAvCallAudioMuted,
        toggleCallVideoMuted: toggleAvCallVideoMuted,
    };
}

export type { GroupMeetParticipant };
