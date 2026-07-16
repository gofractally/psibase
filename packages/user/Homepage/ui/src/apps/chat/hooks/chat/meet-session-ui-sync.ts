import type { MutableRefObject } from "react";

import type { PresenceUi } from "../../lib/chat-timeline-types";
import type { ConversationSnapshot } from "../../lib/protocol";
import type { GroupMeetLifecycleBySpace } from "../../lib/group-meet-lifecycle-ui";

import {
    type AvCallSessionOrchestrator,
    type AvCallSessionPhase,
    type AvCallSessionSnapshot,
} from "../../lib/av-call-session-orchestrator";
import { avCallConnectivityErrorMessage } from "../../lib/av-call-session-types";
import {
    avCallTerminalUiMessage,
    isAvCallTerminalReason,
} from "../../lib/av-call-terminal";
import { shouldBlockGroupMeetRearm } from "../../lib/group-meet-lifecycle-ui";
import {
    buildGroupMeetParticipants,
    buildGroupMeetRemoteStreamMap,
    groupMeetDisplayPeer,
    groupMeetFullyConnected,
    groupMeetStatusLabel,
} from "../../lib/group-meet-ui-state";
import type { ActiveCall } from "./chat-socket-types";

export function shouldBlockGroupMeetUiRearm(
    lifecycle: GroupMeetLifecycleBySpace,
    spaceUuid: string,
    orch?: AvCallSessionOrchestrator | null,
): boolean {
    if (shouldBlockGroupMeetRearm(lifecycle, spaceUuid)) return true;
    return orch?.shouldBlockGroupMeetRearm?.(spaceUuid) ?? false;
}

export function avCallPhaseUiLabel(phase: AvCallSessionPhase): string {
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

export type SyncAvCallUiDeps = {
    selfRef: MutableRefObject<string | null>;
    avCallOrchestratorRef: MutableRefObject<AvCallSessionOrchestrator | null>;
    conversationsRef: MutableRefObject<ConversationSnapshot[]>;
    presenceByAccountRef: MutableRefObject<Record<string, PresenceUi>>;
    resolveConversationSync: (
        spaceUuid: string,
    ) => ConversationSnapshot | undefined;
    setLastInboundError: (value: string | null) => void;
    refreshObjectiveCallEventsForSpaceRef: MutableRefObject<
        (spaceUuid: string) => Promise<void>
    >;
    activeCallRef: MutableRefObject<ActiveCall | null>;
    setActiveCall: (
        update: ActiveCall | null | ((prev: ActiveCall | null) => ActiveCall | null),
    ) => void;
    avCallUiArmedRef: MutableRefObject<string | null>;
    avCallDirectionRef: MutableRefObject<"incoming" | "outgoing">;
    hangupInProgressSpaceRef: MutableRefObject<string | null>;
    groupMeetRejoinHintRef: MutableRefObject<{
        spaceUuid: string;
        sessionId: string;
        joinedCount: number;
    } | null>;
    setGroupMeetRejoinHint: (
        update:
            | { spaceUuid: string; sessionId: string; joinedCount: number }
            | null
            | ((
                  prev: {
                      spaceUuid: string;
                      sessionId: string;
                      joinedCount: number;
                  } | null,
              ) =>
                  | {
                        spaceUuid: string;
                        sessionId: string;
                        joinedCount: number;
                    }
                  | null),
    ) => void;
    groupMeetLifecycleRef: MutableRefObject<GroupMeetLifecycleBySpace>;
    groupMeetEverJoinedRef: MutableRefObject<Set<string>>;
    ringOutTimerRef: MutableRefObject<ReturnType<
        typeof globalThis.setTimeout
    > | null>;
    scheduleTerminalCallDismissRef: MutableRefObject<
        (match: { callId?: string; spaceUuid?: string }) => void
    >;
    clearAvCallMedia: () => void;
    setAvCallLocalStream: (stream: MediaStream | null) => void;
    setAvCallRemoteStreamsByAccount: (
        map: Record<string, MediaStream | null>,
    ) => void;
};

function createHangupOnRingTimeout(
    deps: Pick<SyncAvCallUiDeps, "avCallOrchestratorRef" | "selfRef">,
) {
    const { avCallOrchestratorRef, selfRef } = deps;
    return (spaceUuid: string) => {
        const orch = avCallOrchestratorRef.current;
        if (!orch) return;
        const run = orch.getRun(spaceUuid);
        const self = selfRef.current;
        if (
            run?.kind === "group" &&
            run.snapshot.sessionId &&
            self &&
            orch.othersStillJoinedInGroupMeet(run.snapshot.sessionId, self)
        ) {
            return;
        }
        orch.hangupAvCallSession(spaceUuid, "timeout");
    };
}

/**
 * Applies an `AvCallSessionSnapshot` from the orchestrator to the Meet UI
 * state (`activeCall`, media placeholders, ring timers, terminal frames).
 */
export function createSyncAvCallUiFromSnapshot(deps: SyncAvCallUiDeps) {
    const {
        selfRef,
        avCallOrchestratorRef,
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
    } = deps;

    const hangupOnRingTimeout = createHangupOnRingTimeout({
        avCallOrchestratorRef,
        selfRef,
    });

    return (spaceUuid: string, snap: AvCallSessionSnapshot) => {
        const armed = avCallUiArmedRef.current;
        const active = activeCallRef.current;
        const showUi =
            armed === spaceUuid ||
            (active?.conversationId === spaceUuid &&
                active.source === "av-call");

        if (
            hangupInProgressSpaceRef.current === spaceUuid &&
            snap.phase !== "idle" &&
            snap.phase !== "failed"
        ) {
            return;
        }

        if (
            groupMeetRejoinHintRef.current?.spaceUuid === spaceUuid &&
            !activeCallRef.current
        ) {
            return;
        }

        if (
            shouldBlockGroupMeetUiRearm(
                groupMeetLifecycleRef.current,
                spaceUuid,
                avCallOrchestratorRef.current,
            )
        ) {
            if (
                activeCallRef.current?.conversationId === spaceUuid &&
                activeCallRef.current.source === "av-call"
            ) {
                setActiveCall(null);
                clearAvCallMedia();
            }
            if (snap.phase !== "idle" && snap.phase !== "failed") {
                return;
            }
        }

        if (snap.phase === "failed" || snap.phase === "idle") {
            groupMeetEverJoinedRef.current.delete(spaceUuid);
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
                setActiveCall((prev) => {
                    if (
                        prev?.conversationId === spaceUuid &&
                        prev.source === "av-call"
                    ) {
                        return { ...prev, status: "ended", lastFrame };
                    }
                    // Armed UI with a missing/stale activeCall (e.g. race
                    // cleared Connected) — still surface the terminal frame.
                    return {
                        callId: snap.sessionId ?? prev?.callId ?? "",
                        conversationId: spaceUuid,
                        peerAccount: prev?.peerAccount ?? "",
                        direction:
                            prev?.direction ?? avCallDirectionRef.current,
                        wantVideo: prev?.wantVideo ?? true,
                        wantAudio: prev?.wantAudio ?? true,
                        startedAt: prev?.startedAt ?? Date.now(),
                        status: "ended",
                        source: "av-call",
                        lastFrame,
                        callKind: prev?.callKind ?? "dm",
                        groupParticipants: prev?.groupParticipants,
                    };
                });
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
            if (hangupInProgressSpaceRef.current === spaceUuid) {
                hangupInProgressSpaceRef.current = null;
            }
            return;
        }

        if (!showUi) return;

        const self = selfRef.current;
        if (!self) return;

        const conversation = resolveConversationSync(spaceUuid);
        if (!conversation) return;

        const run = avCallOrchestratorRef.current?.getRun(spaceUuid);
        if (run?.kind === "group" && ringOutTimerRef.current != null) {
            globalThis.clearTimeout(ringOutTimerRef.current);
            ringOutTimerRef.current = null;
        }
        const wantVideo =
            run?.kind === "dm" || run?.kind === "group"
                ? run.wantVideo
                : true;
        const wantAudio =
            run?.kind === "dm" || run?.kind === "group"
                ? run.wantAudio
                : true;

        const sessionId = snap.sessionId;
        const preSessionArmed =
            armed === spaceUuid &&
            !sessionId &&
            (snap.phase === "ensuring" ||
                snap.phase === "creating" ||
                snap.phase === "joining");
        if (!sessionId && !preSessionArmed) return;

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
            const rosterJoined = sessionId
                ? (avCallOrchestratorRef.current?.getAvCallSessionJoinedParticipants(
                      sessionId,
                  ) ?? [])
                : [];
            const allMembersJoined =
                conversation.members.length > 0 &&
                conversation.members.every(
                    (member) =>
                        member === self || rosterJoined.includes(member),
                );
            const liveRemoteCount =
                run?.kind === "group"
                    ? Object.values(
                          buildGroupMeetRemoteStreamMap(run.meshPeers),
                      ).filter((stream) => stream != null).length
                    : 0;
            const groupDirection =
                activeCallRef.current?.conversationId === spaceUuid &&
                activeCallRef.current.source === "av-call"
                    ? activeCallRef.current.direction
                    : avCallDirectionRef.current;
            const remotesInSession = conversation.members.filter(
                (member) =>
                    member !== self && rosterJoined.includes(member),
            );
            const groupMediaReady =
                allMembersJoined ||
                groupMeetFullyConnected(
                    conversation.members,
                    self,
                    presenceByAccountRef.current,
                    rosterJoined,
                    snap.meshPeerSignalingReady,
                ) ||
                (groupDirection !== "outgoing" && liveRemoteCount > 0);
            const outgoingPeersPresent =
                remotesInSession.length > 0 ||
                Object.values(snap.meshPeerSignalingReady ?? {}).some(
                    (ready) => ready,
                );
            const isConnected =
                (snap.phase === "ready" || snap.phase === "signaling") &&
                (groupDirection !== "outgoing"
                    ? groupMediaReady
                    : outgoingPeersPresent && groupMediaReady);
            if (isConnected) {
                setGroupMeetRejoinHint((prev) =>
                    prev?.spaceUuid === spaceUuid ? null : prev,
                );
            }
            const anyParticipantJoined = groupParticipants.some(
                (participant) => participant.status === "joined",
            );
            if (anyParticipantJoined) {
                groupMeetEverJoinedRef.current.add(spaceUuid);
            }

            if (run?.kind === "group") {
                setAvCallRemoteStreamsByAccount(
                    buildGroupMeetRemoteStreamMap(run.meshPeers),
                );
                if (run.localStream) {
                    setAvCallLocalStream(run.localStream);
                }
            }

            // Group calls use per-member sessionInvites; a host-side ring
            // timeout must not cancel a call once signaling has started.
            if (ringOutTimerRef.current != null) {
                globalThis.clearTimeout(ringOutTimerRef.current);
                ringOutTimerRef.current = null;
            }

            setActiveCall((prev) => {
                if (
                    prev?.conversationId === spaceUuid &&
                    prev.source === "av-call" &&
                    prev.status === "ended"
                ) {
                    return prev;
                }
                const direction =
                    prev?.conversationId === spaceUuid &&
                    prev.source === "av-call"
                        ? prev.direction
                        : avCallDirectionRef.current;
                return {
                    callId: sessionId ?? "",
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
            return;
        }

        const peerAccount =
            conversation.kind === "dm" && conversation.members.length === 2
                ? conversation.members.find((m) => m !== self)
                : null;
        if (!peerAccount) return;

        const joinedParticipants = sessionId
            ? (avCallOrchestratorRef.current?.getAvCallSessionJoinedParticipants(
                  sessionId,
              ) ?? [])
            : [];
        const remoteJoined =
            peerAccount != null && joinedParticipants.includes(peerAccount);
        const direction =
            activeCallRef.current?.conversationId === spaceUuid &&
            activeCallRef.current.source === "av-call"
                ? activeCallRef.current.direction
                : avCallDirectionRef.current;
        const isConnected =
            snap.mediaConnected === true &&
            (direction !== "outgoing" || remoteJoined);

        setActiveCall((prev) => {
            if (
                prev?.conversationId === spaceUuid &&
                prev.source === "av-call" &&
                prev.status === "ended"
            ) {
                return prev;
            }
            const callDirection =
                prev?.conversationId === spaceUuid &&
                prev.source === "av-call"
                    ? prev.direction
                    : avCallDirectionRef.current;
            return {
                callId: sessionId ?? "",
                conversationId: spaceUuid,
                peerAccount,
                direction: callDirection,
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
            direction === "outgoing" &&
            ringOutTimerRef.current == null &&
            run?.kind !== "group"
        ) {
            ringOutTimerRef.current = globalThis.setTimeout(() => {
                ringOutTimerRef.current = null;
                hangupOnRingTimeout(spaceUuid);
            }, 20_000);
        } else if (isConnected && ringOutTimerRef.current != null) {
            globalThis.clearTimeout(ringOutTimerRef.current);
            ringOutTimerRef.current = null;
        }
    };
}
