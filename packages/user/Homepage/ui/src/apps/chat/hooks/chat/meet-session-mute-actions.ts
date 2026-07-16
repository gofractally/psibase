import type { MutableRefObject } from "react";

import type { AvCallSessionOrchestrator } from "../../lib/av-call-session-orchestrator";
import type { ActiveCall } from "./chat-socket-types";

export type MuteActionDeps = {
    activeCallRef: MutableRefObject<ActiveCall | null>;
    avCallOrchestratorRef: MutableRefObject<AvCallSessionOrchestrator | null>;
};

export function createSendAvCallParticipantState(deps: MuteActionDeps) {
    const { activeCallRef, avCallOrchestratorRef } = deps;

    return (audioMuted: boolean, videoMuted: boolean) => {
        const ac = activeCallRef.current;
        if (ac?.source !== "av-call" || ac.status !== "connected") return;
        const run = avCallOrchestratorRef.current?.getRun(
            ac.conversationId,
        );
        const sessionId = run?.snapshot.sessionId;
        if (!run?.hasJoined || !sessionId) return;
        avCallOrchestratorRef.current
            ?.getSignaling()
            ?.participantState(sessionId, { audioMuted, videoMuted });
    };
}

export type ToggleMuteDeps = MuteActionDeps & {
    avCallAudioMutedRef: MutableRefObject<boolean>;
    avCallVideoMutedRef: MutableRefObject<boolean>;
    setAvCallAudioMuted: (value: boolean) => void;
    setAvCallVideoMuted: (value: boolean) => void;
    sendAvCallParticipantState: (
        audioMuted: boolean,
        videoMuted: boolean,
    ) => void;
};

export function createToggleAvCallAudioMuted(deps: ToggleMuteDeps) {
    const {
        activeCallRef,
        avCallOrchestratorRef,
        avCallAudioMutedRef,
        avCallVideoMutedRef,
        setAvCallAudioMuted,
        sendAvCallParticipantState,
    } = deps;

    return () => {
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
    };
}

export function createToggleAvCallVideoMuted(deps: ToggleMuteDeps) {
    const {
        activeCallRef,
        avCallOrchestratorRef,
        avCallAudioMutedRef,
        avCallVideoMutedRef,
        setAvCallVideoMuted,
        sendAvCallParticipantState,
    } = deps;

    return () => {
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
    };
}
