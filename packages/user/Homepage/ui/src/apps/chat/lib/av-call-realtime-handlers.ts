import { avCallLog, shortSessionId, shortSpaceId } from "./av-call-debug";
import { normalizeAvCallTerminalReason } from "./av-call-terminal";
import { commitAvCallTimelineEvent } from "./av-call-timeline-commit";
import {
    dmPeerAccount,
    isGroupMembers,
    shouldInitiateOffer,
    type AvCallIncomingInvite,
    type AvCallOrchestratorHost,
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

function onSessionInvite(
    host: AvCallOrchestratorHost,
    frame: Extract<ServerRealtimeFrame, { t: "sessionInvite" }>,
): void {
    if (frame.purpose !== "av-call") return;
    const self = host.getSelf();
    if (!self) return;

    avCallLog("sessionInvite", {
        sessionId: shortSessionId(frame.sessionId),
        from: frame.from,
        space: shortSpaceId(frame.appMetadata.spaceUuid),
        participantCount: frame.participants.length,
    });

    const spaceUuid = frame.appMetadata.spaceUuid;
    const isGroup = isGroupMembers(frame.participants);

    const existing = host.getRun(spaceUuid);
    if (
        existing?.snapshot.sessionId &&
        existing.snapshot.sessionId !== frame.sessionId
    ) {
        return;
    }

    if (
        existing?.hasJoined &&
        existing.snapshot.sessionId === frame.sessionId &&
        existing.snapshot.signalingJoined
    ) {
        avCallLog("sessionInvite ignored (already joined)", {
            phase: existing.snapshot.phase,
        });
        return;
    }

    const invite: AvCallIncomingInvite = {
        sessionId: frame.sessionId,
        spaceUuid,
        from: frame.from,
        wantVideo: avCallTransportsWantVideo(frame.transports),
        wantAudio: avCallTransportsWantAudio(frame.transports),
        participants: [...frame.participants],
    };

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
                onUpdate: () => {
                    host.onSpaceUpdate?.(spaceUuid, host.liveSnapshot(dmRun));
                },
            };
            host.setRun(spaceUuid, dmRun);
        }
    } else {
        existing.snapshot = {
            ...existing.snapshot,
            sessionId: frame.sessionId,
            phase: "waiting-peer",
        };
        existing.onUpdate();
    }

    host.setPendingInvite(invite);
}

function onSignal(
    host: AvCallOrchestratorHost,
    frame: Extract<ServerRealtimeFrame, { t: "signal" }>,
): void {
    const self = host.getSelf();
    if (!self || frame.to !== self) return;

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

    void (async () => {
        if (run!.kind === "group") {
            const from =
                frame.from ??
                run!.members.find((member) => member !== self);
            if (!from || from === self) {
                avCallLog("onSignal: group missing from");
                return;
            }
            if (!run!.meshPeers.has(from)) {
                await host.beginSignaling(run!, frame.sessionId);
            }
            const meshPeer = run!.meshPeers.get(from);
            if (!meshPeer) {
                avCallLog("onSignal: waiting for group mesh peer", { from });
                return;
            }
            await meshPeer.handleRemoteSignal({
                from,
                kind: frame.kind,
                sdp: frame.sdp,
                candidate: frame.candidate,
                sdpMid: frame.sdpMid,
                sdpMLineIndex: frame.sdpMLineIndex,
            });
            return;
        }

        if (!run!.peer) {
            await host.beginSignaling(run!, frame.sessionId);
        }
        const dmRun = run as DmAvCallRun;
        if (!dmRun.peer) {
            avCallLog("onSignal: waiting for dm peer after beginSignaling");
            return;
        }
        await dmRun.peer.handleRemoteSignal({
            from: frame.from,
            kind: frame.kind,
            sdp: frame.sdp,
            candidate: frame.candidate,
            sdpMid: frame.sdpMid,
            sdpMLineIndex: frame.sdpMLineIndex,
        });
    })();
}

function onSessionEnded(
    host: AvCallOrchestratorHost,
    frame: Extract<ServerRealtimeFrame, { t: "sessionEnded" }>,
): void {
    const run = host.findRunBySessionId(frame.sessionId);
    if (!run) return;
    host.onInviteCleared?.(frame.sessionId);
    const terminalReason = normalizeAvCallTerminalReason(
        frame.reason || "session ended",
    );
    host.tearDownSignaling(run, terminalReason);
    commitAvCallTimelineEvent(frame.sessionId, frame.reason || terminalReason);
    run.hasJoined = false;
    host.setPhase(run, "failed", {
        lastError: terminalReason,
        signalingJoined: false,
        meshPeerSignalingReady: run.kind === "group" ? {} : undefined,
    });
}

export function wireAvCallRealtimeHandlers(
    host: AvCallOrchestratorHost,
): boolean {
    const rt = host.getRealtime();
    if (!rt) return false;

    host.setSignaling(new WebRtcSignalingClient(rt));
    rt.registerHandlers({
        sessionInvite: (frame) => onSessionInvite(host, frame),
        participantJoined: (frame) => {
            const self = host.getSelf();
            if (!self || frame.participant === self) return;
            avCallLog("participantJoined", {
                sessionId: shortSessionId(frame.sessionId),
                participant: frame.participant,
            });
            let run = host.findRunBySessionId(frame.sessionId);
            if (!run) {
                for (const candidate of host.getRuns()) {
                    if (
                        candidate.kind === "dm" &&
                        candidate.peerAccount === frame.participant
                    ) {
                        run = candidate;
                        break;
                    }
                    if (
                        candidate.kind === "group" &&
                        candidate.members.includes(frame.participant)
                    ) {
                        run = candidate;
                        break;
                    }
                }
            }
            if (!run) return;
            run.snapshot = {
                ...run.snapshot,
                sessionId: frame.sessionId,
            };
            void (async () => {
                if (run!.kind === "group") {
                    const meshPeer = run!.meshPeers.get(frame.participant);
                    if (meshPeer?.isMediaConnected) {
                        host.tearDownMeshSignalingPeer(
                            run!,
                            frame.participant,
                            "peer re-joined session",
                        );
                    }
                    await host.beginSignaling(run!, frame.sessionId);
                    const peer = run!.meshPeers.get(frame.participant);
                    if (
                        peer &&
                        shouldInitiateOffer(self, frame.participant)
                    ) {
                        avCallLog("resendOffer after group peer joined");
                        peer.resendOffer();
                    }
                    host.onPeerOnline(frame.participant);
                    return;
                }

                await host.beginSignaling(run!, frame.sessionId);
                const dmRun = run as DmAvCallRun;
                if (
                    dmRun.peer &&
                    shouldInitiateOffer(self, dmRun.peerAccount)
                ) {
                    dmRun.peer.resendOffer();
                }
            })();
        },
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
            host.fail(
                run,
                `${frame.code}: ${frame.reason}`.slice(0, 500),
            );
        },
    });
    avCallLog("realtime handlers installed");
    return true;
}
