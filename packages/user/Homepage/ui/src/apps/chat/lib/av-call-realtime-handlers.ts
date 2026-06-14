import { avCallLog, shortSessionId, shortSpaceId } from "./av-call-debug";
import { syncMeshAvCallPeers } from "./av-call-group-orchestrator";
import type { GroupMeetRunContext } from "./group-meet-attempt-coordinator";
import { normalizeAvCallTerminalReason } from "./av-call-terminal";
import { closeAvCallSession } from "./chat-api";
import {
    dmPeerAccount,
    isGroupMembers,
    type AvCallOrchestratorHost,
    type AvCallSpaceRun,
    type DmAvCallRun,
    type GroupAvCallRun,
} from "./av-call-session-types";
import type { ServerRealtimeFrame } from "./realtime-protocol";
import { WebRtcSignalingClient } from "./webrtc-signaling-client";

function avCallTransportsWantVideo(transports: readonly string[]): boolean {
    return transports.includes("video");
}

function avCallTransportsWantAudio(transports: readonly string[]): boolean {
    return transports.includes("audio");
}

function groupMeetRunContext(
    run: AvCallSpaceRun | undefined,
    phase: string,
): GroupMeetRunContext | null {
    if (!run) return null;
    return {
        phase,
        sessionId: run.snapshot.sessionId,
        hasJoined: run.hasJoined,
        awaitingInviteAccept: run.awaitingInviteAccept,
        signalingJoined: run.snapshot.signalingJoined,
    };
}

function applyGroupSessionInviteDecision(
    host: AvCallOrchestratorHost,
    frame: Extract<ServerRealtimeFrame, { t: "sessionInvite" }>,
    existing: AvCallSpaceRun | undefined,
    existingPhase: string,
): boolean {
    const spaceUuid = frame.appMetadata.spaceUuid;
    const decision = host.classifyGroupMeetSessionInvite?.(
        spaceUuid,
        frame.sessionId,
        groupMeetRunContext(existing, existingPhase),
    );
    if (!decision) return true;

    if (decision.action === "ignore-stale") {
        avCallLog("sessionInvite ignored (coordinator)", {
            sessionId: shortSessionId(frame.sessionId),
            space: shortSpaceId(spaceUuid),
            reason: decision.reason,
        });
        return false;
    }

    if (decision.action === "refresh-pending-invite") {
        const run = host.getRun(spaceUuid);
        if (run && host.dispatchRunEventForRun) {
            host.dispatchRunEventForRun(run, {
                type: "sessionInvite",
                sessionId: frame.sessionId,
                from: frame.from,
                wantVideo: avCallTransportsWantVideo(frame.transports),
                wantAudio: avCallTransportsWantAudio(frame.transports),
            });
        }
        return false;
    }

    return true;
}

function onSessionInvite(
    host: AvCallOrchestratorHost,
    frame: Extract<ServerRealtimeFrame, { t: "sessionInvite" }>,
): void {
    if (frame.purpose !== "av-call") return;
    const self = host.getSelf();
    if (!self) return;

    const isGroup = isGroupMembers(frame.participants);
    if (!isGroup && host.isRetiredAvCallSession?.(frame.sessionId)) {
        return;
    }

    avCallLog("sessionInvite", {
        sessionId: shortSessionId(frame.sessionId),
        from: frame.from,
        space: shortSpaceId(frame.appMetadata.spaceUuid),
        participantCount: frame.participants.length,
    });

    const spaceUuid = frame.appMetadata.spaceUuid;

    const existing = host.getRun(spaceUuid);
    const existingPhase = existing
        ? host.liveSnapshot(existing).phase
        : "idle";

    if (isGroup) {
        if (
            !applyGroupSessionInviteDecision(
                host,
                frame,
                existing,
                existingPhase,
            )
        ) {
            return;
        }
    } else if (host.isGroupMeetLeaveInProgress?.(spaceUuid)) {
        avCallLog("sessionInvite ignored (group leave in progress)", {
            sessionId: shortSessionId(frame.sessionId),
            space: shortSpaceId(spaceUuid),
        });
        return;
    } else if (
        existing?.snapshot.sessionId &&
        existing.snapshot.sessionId !== frame.sessionId &&
        existingPhase !== "failed" &&
        existingPhase !== "idle"
    ) {
        return;
    } else if (
        existing?.snapshot.sessionId === frame.sessionId &&
        existingPhase !== "idle" &&
        existingPhase !== "failed"
    ) {
        const duplicateWhileActive =
            (existingPhase === "waiting-peer" && existing.hasJoined) ||
            existingPhase === "joining" ||
            existingPhase === "signaling" ||
            existingPhase === "ready" ||
            (existing.hasJoined && existing.snapshot.signalingJoined);
        if (duplicateWhileActive) {
            if (existing.awaitingInviteAccept) {
                host.dispatchRunEventForRun?.(existing, {
                    type: "sessionInvite",
                    sessionId: frame.sessionId,
                    from: frame.from,
                    wantVideo: avCallTransportsWantVideo(frame.transports),
                    wantAudio: avCallTransportsWantAudio(frame.transports),
                });
                return;
            }
            avCallLog("sessionInvite ignored (duplicate for active session)", {
                phase: existingPhase,
                hasJoined: existing.hasJoined,
                awaitingInviteAccept: existing.awaitingInviteAccept,
                signalingJoined: existing.snapshot.signalingJoined,
            });
            return;
        }
    }

    if (existing) {
        existing.hasJoined = false;
        existing.awaitingInviteAccept = true;
        existing.snapshot = {
            ...existing.snapshot,
            sessionId: frame.sessionId,
            signalingJoined: false,
            mediaConnected:
                existing.kind === "dm" ? false : existing.snapshot.mediaConnected,
            meshPeerSignalingReady:
                existing.kind === "group"
                    ? {}
                    : existing.snapshot.meshPeerSignalingReady,
            lastError: undefined,
        };
        existing.onUpdate();
    }

    if (!existing) {
        const abort = new AbortController();
        if (isGroup) {
            const groupRun: GroupAvCallRun = {
                kind: "group",
                spaceUuid,
                members: [...frame.participants],
                meshPeers: new Map(),
                wantVideo: avCallTransportsWantVideo(frame.transports),
                wantAudio: avCallTransportsWantAudio(frame.transports),
                localStream: null,
                peerOnlineAtSessionStart: new Map(),
                abort,
                snapshot: {
                    spaceUuid,
                    phase: "waiting-peer",
                    sessionId: frame.sessionId,
                    signalingJoined: false,
                    meshPeerSignalingReady: {},
                },
                hasJoined: false,
                transportRecoveryAttempt: 0,
                awaitingInviteAccept: true,
                onUpdate: () => {
                    host.onSpaceUpdate?.(spaceUuid, host.liveSnapshot(groupRun));
                },
            };
            host.setRun(spaceUuid, groupRun);
        } else {
            const peer = dmPeerAccount(frame.participants, self);
            if (!peer) return;
            const dmRun: DmAvCallRun = {
                kind: "dm",
                spaceUuid,
                members: [...frame.participants],
                peerAccount: peer,
                wantVideo: avCallTransportsWantVideo(frame.transports),
                wantAudio: avCallTransportsWantAudio(frame.transports),
                peer: null,
                abort,
                snapshot: {
                    spaceUuid,
                    phase: "waiting-peer",
                    sessionId: frame.sessionId,
                    signalingJoined: false,
                    mediaConnected: false,
                },
                hasJoined: false,
                transportRecoveryAttempt: 0,
                awaitingInviteAccept: true,
                onUpdate: () => {
                    host.onSpaceUpdate?.(spaceUuid, host.liveSnapshot(dmRun));
                },
            };
            host.setRun(spaceUuid, dmRun);
        }
    }

    const run = host.getRun(spaceUuid);
    if (!run || !host.dispatchRunEventForRun) return;

    host.dispatchRunEventForRun(run, {
        type: "sessionInvite",
        sessionId: frame.sessionId,
        from: frame.from,
        wantVideo: avCallTransportsWantVideo(frame.transports),
        wantAudio: avCallTransportsWantAudio(frame.transports),
    });
}

function onSignal(
    host: AvCallOrchestratorHost,
    frame: Extract<ServerRealtimeFrame, { t: "signal" }>,
): void {
    const self = host.getSelf();
    if (!self || frame.to !== self) return;

    if (host.usesSharedTransport?.()) {
        avCallLog("onSignal skipped (pair PC handles WebRTC SDP)", {
            sessionId: shortSessionId(frame.sessionId),
            kind: frame.kind,
        });
        return;
    }

    let run = host.findRunBySessionId(frame.sessionId);
    if (!run) {
        avCallLog("onSignal: no run for session (dropped)", {
            sessionId: shortSessionId(frame.sessionId),
            kind: frame.kind,
        });
        return;
    }

    avCallLog("onSignal", {
        sessionId: shortSessionId(frame.sessionId),
        from: frame.from,
        kind: frame.kind,
        spaceKind: run.kind,
    });

    if (!host.dispatchRunEventAndWait) return;

    const from =
        run.kind === "group"
            ? frame.from ?? run.members.find((member) => member !== self)
            : frame.from;
    if (!from || from === self) {
        avCallLog("onSignal: missing or self from");
        return;
    }

    void host.dispatchRunEventAndWait(run, {
        type: "remoteSignal",
        sessionId: frame.sessionId,
        from,
        kind: frame.kind,
        sdp: frame.sdp,
        candidate: frame.candidate,
        sdpMid: frame.sdpMid,
        sdpMLineIndex: frame.sdpMLineIndex,
    });
}

function findRunForParticipantJoined(
    host: AvCallOrchestratorHost,
    sessionId: string,
    participant: string,
): AvCallSpaceRun | undefined {
    const bySession = host.findRunBySessionId(sessionId);
    if (bySession) return bySession;

    for (const candidate of host.getRuns()) {
        if (candidate.snapshot.phase === "failed") continue;
        if (candidate.snapshot.sessionId && candidate.snapshot.sessionId !== sessionId) {
            continue;
        }
        if (
            candidate.kind === "dm" &&
            candidate.peerAccount === participant
        ) {
            return candidate;
        }
        if (
            candidate.kind === "group" &&
            candidate.members.includes(participant)
        ) {
            return candidate;
        }
    }
    return undefined;
}

function onParticipantJoined(
    host: AvCallOrchestratorHost,
    frame: Extract<ServerRealtimeFrame, { t: "participantJoined" }>,
): void {
    const self = host.getSelf();
    if (!self || frame.participant === self) return;
    if (host.isRetiredAvCallSession?.(frame.sessionId)) return;
    if (!host.dispatchRunEventForRun) return;

    avCallLog("participantJoined", {
        sessionId: shortSessionId(frame.sessionId),
        participant: frame.participant,
    });

    const run = findRunForParticipantJoined(
        host,
        frame.sessionId,
        frame.participant,
    );
    if (!run) return;

    if (run.kind === "group") {
        const phase = host.liveSnapshot(run).phase;
        const decision = host.classifyGroupMeetParticipantJoined?.(
            run.spaceUuid,
            frame.sessionId,
            groupMeetRunContext(run, phase),
        );
        if (decision?.action === "ignore-stale") {
            avCallLog("participantJoined ignored (coordinator)", {
                sessionId: shortSessionId(frame.sessionId),
                participant: frame.participant,
                reason: decision.reason,
            });
            return;
        }
    } else if (run.awaitingInviteAccept) {
        avCallLog("participantJoined deferred (pending invite accept)", {
            sessionId: shortSessionId(frame.sessionId),
            participant: frame.participant,
        });
        return;
    }

    const pending =
        host.getAvCallSessionPendingParticipants?.(frame.sessionId) ?? [];
    const joined =
        host.getAvCallSessionJoinedParticipants?.(frame.sessionId) ?? [];
    const pendingRejoin =
        host.isAvCallPendingRejoin?.(frame.sessionId, frame.participant) ||
        (pending.includes(frame.participant) &&
            host.isAvCallRecentDeparture?.(
                frame.sessionId,
                frame.participant,
            ) === true);
    if (
        pending.includes(frame.participant) &&
        host.isAvCallRecentDeparture?.(frame.sessionId, frame.participant)
    ) {
        host.markAvCallPendingRejoin?.(frame.sessionId, frame.participant);
    }

    const meshPeer =
        run.kind === "group" ? run.meshPeers.get(frame.participant) : undefined;
    const establishedMesh =
        run.kind === "group" &&
        (run.snapshot.phase === "ready" || run.snapshot.phase === "signaling") &&
        meshPeer !== undefined &&
        !meshPeer.isDisposed &&
        (meshPeer.isMediaConnected || meshPeer.getRemoteStream() != null);

    if (establishedMesh && !pendingRejoin) {
        avCallLog("participantJoined ignored (mesh already connected)", {
            sessionId: shortSessionId(frame.sessionId),
            participant: frame.participant,
        });
        return;
    }

    if (
        joined.includes(frame.participant) &&
        !pendingRejoin &&
        !host.isAvCallRecentDeparture?.(frame.sessionId, frame.participant)
    ) {
        avCallLog("participantJoined ignored (already joined)", {
            sessionId: shortSessionId(frame.sessionId),
            participant: frame.participant,
        });
        return;
    }

    host.dispatchRunEventForRun(run, {
        type: "participantJoined",
        sessionId: frame.sessionId,
        participant: frame.participant,
    });
    if (
        run.kind === "group" &&
        self &&
        (run.snapshot.phase === "ready" || run.snapshot.phase === "signaling")
    ) {
        const sessionId = run.snapshot.sessionId ?? frame.sessionId;
        const peer = run.meshPeers.get(frame.participant);
        if (sessionId && !peer?.isMediaConnected) {
            syncMeshAvCallPeers(host, run, sessionId, self);
        }
    }
    host.onPeerOnline(frame.participant);
}

function onSessionEnded(
    host: AvCallOrchestratorHost,
    frame: Extract<ServerRealtimeFrame, { t: "sessionEnded" }>,
): void {
    if (host.isRetiredAvCallSession?.(frame.sessionId)) return;
    const run = host.findRunBySessionId(frame.sessionId);
    if (!run) return;
    if (!host.dispatchRunEventAndWait) return;

    if (run.kind === "group") {
        const joined =
            host.getAvCallSessionJoinedParticipants?.(frame.sessionId) ?? [];
        const pending =
            host.getAvCallSessionPendingParticipants?.(frame.sessionId) ?? [];
        const peer = frame.by ? run.meshPeers.get(frame.by) : undefined;
        const peerMediaActive =
            peer != null &&
            !peer.isDisposed &&
            (peer.isMediaConnected || peer.getRemoteStream() != null);
        const decision = host.classifyGroupMeetSessionEnded?.(frame.sessionId, {
            by: frame.by,
            reason: frame.reason || "session ended",
            joinedRoster: joined,
            pendingRoster: pending,
            peerMediaActive,
        });
        if (decision?.action === "ignore-stale") {
            avCallLog("sessionEnded ignored (coordinator)", {
                sessionId: shortSessionId(frame.sessionId),
                by: frame.by,
                reason: decision.reason,
            });
            if (frame.by) {
                host.clearAvCallPendingRejoin?.(frame.sessionId, frame.by);
            }
            return;
        }
    } else if (
        frame.reason === "left" &&
        frame.by &&
        host.isAvCallPendingRejoin?.(frame.sessionId, frame.by) &&
        host.getAvCallSessionPendingParticipants?.(frame.sessionId)?.includes(
            frame.by,
        )
    ) {
        avCallLog("sessionEnded ignored (stale leave while rejoin pending)", {
            sessionId: shortSessionId(frame.sessionId),
            by: frame.by,
        });
        return;
    }

    const terminalReason = normalizeAvCallTerminalReason(
        frame.reason || "session ended",
    );

    void host
        .dispatchRunEventAndWait(run, {
            type: "sessionEnded",
            sessionId: frame.sessionId,
            reason: frame.reason || terminalReason,
            by: frame.by,
        })
        .then(() => {
            if (run.snapshot.phase === "failed") {
                host.recordAvCallSessionSnapshot?.(
                    frame.sessionId,
                    [],
                    [],
                );
                host.onInviteCleared?.(frame.sessionId);
                // Group meet reuses the same objective session after everyone
                // leaves; retiring here would drop the next sessionInvite fanout.
                if (run.kind === "dm") {
                    host.retireAvCallSession?.(frame.sessionId);
                    void closeAvCallSession(
                        frame.sessionId,
                        terminalReason,
                    ).catch(() => {});
                }
            } else {
                if (frame.by) {
                    host.removeParticipantFromAvCallSessionRoster?.(
                        frame.sessionId,
                        frame.by,
                    );
                }
                avCallLog("sessionEnded: partial leave (meetCall FSM)", {
                    sessionId: shortSessionId(frame.sessionId),
                    by: frame.by,
                    reason: terminalReason,
                    phase: run.snapshot.phase,
                });
            }
            run.onUpdate();
        });
}

export function wireAvCallRealtimeHandlers(
    host: AvCallOrchestratorHost,
    existingSignaling?: WebRtcSignalingClient | null,
): boolean {
    const rt = host.getRealtime();
    if (!rt) return false;

    host.setSignaling(existingSignaling ?? new WebRtcSignalingClient(rt));
    rt.registerHandlers({
        sessionInvite: (frame) => onSessionInvite(host, frame),
        sessionSnapshot: (frame) => {
            host.applyAvCallSessionSnapshotFromRealtime?.(
                frame.sessionId,
                frame.joinedParticipants,
                frame.pendingParticipants,
                frame.epoch,
            );
        },
        participantJoined: (frame) => onParticipantJoined(host, frame),
        signal: (frame) => onSignal(host, frame),
        participantState: (frame) => {
            avCallLog("participantState", {
                sessionId: shortSessionId(frame.sessionId),
                participant: frame.participant,
                audioMuted: frame.state.audioMuted,
                videoMuted: frame.state.videoMuted,
            });
            host.onParticipantState?.(
                frame.sessionId,
                frame.participant,
                frame.state,
            );
        },
        sessionEnded: (frame) => onSessionEnded(host, frame),
        error: (frame) => {
            if (!frame.sessionId) return;
            const run = host.findRunBySessionId(frame.sessionId);
            if (!run) return;
            if (
                frame.code === "session-not-active" ||
                frame.code === "not-joined"
            ) {
                if (
                    run.snapshot.phase === "failed" ||
                    !run.hasJoined ||
                    run.snapshot.phase === "ready" ||
                    run.snapshot.phase === "signaling"
                ) {
                    return;
                }
                void host.recoverStaleAvCallSession?.(
                    run,
                    frame.sessionId,
                );
                return;
            }
            host.fail(
                run,
                `${frame.code}: ${frame.reason}`.slice(0, 500),
            );
        },
    });
    avCallLog("realtime handlers installed");
    return true;
}
