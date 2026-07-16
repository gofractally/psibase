import type { MutableRefObject } from "react";

import type { PresenceUi } from "../../lib/chat-timeline-types";
import type { ConversationSnapshot } from "../../lib/protocol";
import type { GroupMeetLifecycleBySpace } from "../../lib/group-meet-lifecycle-ui";

import type { AvCallSessionOrchestrator } from "../../lib/av-call-session-orchestrator";
import {
    buildGroupMeetParticipants,
    buildGroupMeetRemoteStreamMap,
    groupMeetDisplayPeer,
    groupMeetFullyConnected,
    groupMeetStatusLabel,
} from "../../lib/group-meet-ui-state";
import type { ActiveCall } from "./chat-socket-types";
import { shouldBlockGroupMeetUiRearm } from "./meet-session-ui-sync";

export type HandleAvCallMediaReadyDeps = {
    avCallOrchestratorRef: MutableRefObject<AvCallSessionOrchestrator | null>;
    hangupInProgressSpaceRef: MutableRefObject<string | null>;
    groupMeetLifecycleRef: MutableRefObject<GroupMeetLifecycleBySpace>;
    activeCallRef: MutableRefObject<ActiveCall | null>;
    avCallUiArmedRef: MutableRefObject<string | null>;
    avCallDirectionRef: MutableRefObject<"incoming" | "outgoing">;
    setAvCallAudioOnlyFallback: (value: boolean) => void;
    setAvCallLocalStream: (stream: MediaStream | null) => void;
    setAvCallRemoteStreamsByAccount: (
        map: Record<string, MediaStream | null>,
    ) => void;
    setAvCallRemoteStream: (stream: MediaStream | null) => void;
    setActiveCall: (
        update: ActiveCall | null | ((prev: ActiveCall | null) => ActiveCall | null),
    ) => void;
    conversationsRef: MutableRefObject<ConversationSnapshot[]>;
    selfRef: MutableRefObject<string | null>;
    presenceByAccountRef: MutableRefObject<Record<string, PresenceUi>>;
    ringOutTimerRef: MutableRefObject<ReturnType<
        typeof globalThis.setTimeout
    > | null>;
};

export function createHandleAvCallMediaReady(
    deps: HandleAvCallMediaReadyDeps,
) {
    const {
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
    } = deps;

    return (
        spaceUuid: string,
        info: {
            peerAccount: string;
            localStream: MediaStream | null;
            remoteStream: MediaStream | null;
        },
    ) => {
        if (hangupInProgressSpaceRef.current === spaceUuid) return;
        if (
            shouldBlockGroupMeetUiRearm(
                groupMeetLifecycleRef.current,
                spaceUuid,
                avCallOrchestratorRef.current,
            )
        ) {
            return;
        }
        const active = activeCallRef.current;
        if (
            active?.conversationId === spaceUuid &&
            active.source === "av-call" &&
            active.status === "ended"
        ) {
            return;
        }
        const showUi =
            avCallUiArmedRef.current === spaceUuid ||
            (active?.conversationId === spaceUuid &&
                active.source === "av-call");
        if (!showUi) return;
        const run = avCallOrchestratorRef.current?.getRun(spaceUuid);
        if (
            run?.snapshot.phase === "failed" ||
            run?.snapshot.phase === "idle"
        ) {
            return;
        }
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
        const localStream =
            info.localStream ??
            (run?.kind === "group"
                ? run.localStream
                : run?.kind === "dm"
                  ? (run.peer?.getLocalStream() ?? null)
                  : null);
        if (localStream) {
            setAvCallLocalStream(localStream);
        }
        if (run?.kind === "group") {
            setAvCallRemoteStreamsByAccount(
                buildGroupMeetRemoteStreamMap(run.meshPeers),
            );
            setAvCallRemoteStream(null);
        } else if (info.remoteStream) {
            setAvCallRemoteStream(info.remoteStream);
        }
        setActiveCall((prev) => {
            if (
                prev?.conversationId === spaceUuid &&
                prev.source === "av-call" &&
                prev.status === "ended"
            ) {
                return prev;
            }
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
                const sessionId = run.snapshot.sessionId;
                const remoteStreams = buildGroupMeetRemoteStreamMap(
                    run.meshPeers,
                );
                const liveRemoteCount = Object.values(remoteStreams).filter(
                    (stream) => stream != null,
                ).length;
                const rosterJoined = sessionId
                    ? (avCallOrchestratorRef.current?.getAvCallSessionJoinedParticipants(
                          sessionId,
                      ) ?? [])
                    : [];
                const remotesInSession = conversation.members.filter(
                    (member) =>
                        member !== self && rosterJoined.includes(member),
                );
                const direction =
                    prev?.conversationId === spaceUuid &&
                    prev.source === "av-call"
                        ? prev.direction
                        : avCallDirectionRef.current;
                const groupMediaReady =
                    groupMeetFullyConnected(
                        conversation.members,
                        self,
                        presenceByAccountRef.current,
                        rosterJoined,
                        meshReady,
                    ) ||
                    (direction !== "outgoing" && liveRemoteCount > 0);
                const outgoingPeersPresent =
                    remotesInSession.length > 0 ||
                    Object.values(meshReady).some((ready) => ready);
                const isConnected =
                    (run.snapshot.phase === "ready" ||
                        run.snapshot.phase === "signaling") &&
                    (direction !== "outgoing"
                        ? groupMediaReady
                        : outgoingPeersPresent && groupMediaReady);
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
                if (!showUi) return prev;
                const wantVideo =
                    run?.kind === "dm" || run?.kind === "group"
                        ? run.wantVideo
                        : true;
                const wantAudio =
                    run?.kind === "dm" || run?.kind === "group"
                        ? run.wantAudio
                        : true;
                const direction = avCallDirectionRef.current;
                const sessionId = run?.snapshot.sessionId;
                const remoteJoined =
                    sessionId != null &&
                    (
                        avCallOrchestratorRef.current?.getAvCallSessionJoinedParticipants(
                            sessionId,
                        ) ?? []
                    ).includes(info.peerAccount);
                const dmConnected =
                    direction !== "outgoing" ||
                    remoteJoined ||
                    (info.remoteStream != null &&
                        run?.snapshot.mediaConnected === true);
                return {
                    callId: sessionId ?? "",
                    conversationId: spaceUuid,
                    peerAccount: info.peerAccount,
                    direction,
                    wantVideo,
                    wantAudio,
                    startedAt: Date.now(),
                    status: dmConnected ? "connected" : "ringing",
                    source: "av-call",
                    lastFrame: dmConnected ? "Connected" : "Ringing…",
                    callKind: "dm",
                };
            }
            const wantVideo =
                run?.kind === "dm" || run?.kind === "group"
                    ? run.wantVideo
                    : prev.wantVideo;
            const wantAudio =
                run?.kind === "dm" || run?.kind === "group"
                    ? run.wantAudio
                    : prev.wantAudio;
            const direction = prev.direction ?? avCallDirectionRef.current;
            const sessionId = run?.snapshot.sessionId;
            const remoteJoined =
                sessionId != null &&
                (
                    avCallOrchestratorRef.current?.getAvCallSessionJoinedParticipants(
                        sessionId,
                    ) ?? []
                ).includes(info.peerAccount);
            const dmConnected =
                direction !== "outgoing" ||
                remoteJoined ||
                (info.remoteStream != null &&
                    run?.snapshot.mediaConnected === true);
            return {
                ...prev,
                wantVideo,
                wantAudio,
                status: dmConnected ? "connected" : "ringing",
                lastFrame: dmConnected
                    ? "Connected"
                    : (prev.lastFrame ?? "Ringing…"),
                callKind: "dm",
            };
        });
        const sessionId = run?.snapshot.sessionId;
        const remoteJoined =
            sessionId != null &&
            (
                avCallOrchestratorRef.current?.getAvCallSessionJoinedParticipants(
                    sessionId,
                ) ?? []
            ).includes(info.peerAccount);
        const direction =
            activeCallRef.current?.direction ?? avCallDirectionRef.current;
        const dmConnected =
            run?.kind !== "dm" ||
            direction !== "outgoing" ||
            remoteJoined ||
            (info.remoteStream != null &&
                run.snapshot.mediaConnected === true);
        if (dmConnected && ringOutTimerRef.current != null) {
            globalThis.clearTimeout(ringOutTimerRef.current);
            ringOutTimerRef.current = null;
        }
    };
}

export type HandleAvCallParticipantStateDeps = {
    selfRef: MutableRefObject<string | null>;
    avCallOrchestratorRef: MutableRefObject<AvCallSessionOrchestrator | null>;
    activeCallRef: MutableRefObject<ActiveCall | null>;
    avCallUiArmedRef: MutableRefObject<string | null>;
    setAvCallRemoteAvStateByAccount: (
        update: (
            prev: Record<string, { audioMuted?: boolean; videoMuted?: boolean }>,
        ) => Record<string, { audioMuted?: boolean; videoMuted?: boolean }>,
    ) => void;
    setAvCallRemoteAudioMuted: (value: boolean) => void;
    setAvCallRemoteVideoMuted: (value: boolean) => void;
};

export function createHandleAvCallParticipantState(
    deps: HandleAvCallParticipantStateDeps,
) {
    const {
        selfRef,
        avCallOrchestratorRef,
        activeCallRef,
        avCallUiArmedRef,
        setAvCallRemoteAvStateByAccount,
        setAvCallRemoteAudioMuted,
        setAvCallRemoteVideoMuted,
    } = deps;

    return (
        sessionId: string,
        participant: string,
        state: { audioMuted?: boolean; videoMuted?: boolean },
    ) => {
        const self = selfRef.current;
        if (!self || participant === self) return;

        const run =
            avCallOrchestratorRef.current?.findRunBySessionId(sessionId);
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
    };
}
