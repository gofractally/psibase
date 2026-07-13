import {
    avCallLog,
    avCallRecord,
    shortSessionId,
    shortSpaceId,
} from "./av-call-debug";
import {
    createMeetPeerForRemote,
    shouldReuseMeetPeer,
} from "./av-call-meet-peer-factory";
import {
    type AvCallOrchestratorHost,
    type DmAvCallRun,
    avCallConnectivityErrorMessage,
    dmPeerAccount,
    shouldInitiateOffer,
} from "./av-call-session-types";
import { normalizeAvCallTerminalReason } from "./av-call-terminal";
import { commitAvCallJoin } from "./av-call-timeline-commit";

const DEFAULT_WANT_VIDEO = true;
const DEFAULT_WANT_AUDIO = true;

export function ensureDmAvCallSession(
    host: AvCallOrchestratorHost,
    spaceUuid: string,
    members: readonly string[],
): void {
    const self = host.getSelf();
    if (!self) return;

    const peer = dmPeerAccount(members, self);
    if (!peer) return;

    const existing = host.getRun(spaceUuid);
    if (existing?.kind === "group") {
        return;
    }
    if (existing?.kind === "dm") {
        const peerOnline = host.getPeerPresence()[peer] === "online";
        if (
            host.liveSnapshot(existing).phase === "waiting-peer" &&
            peerOnline &&
            existing.snapshot.sessionId
        ) {
            avCallLog("ensureDmAvCallSession resume waiting-peer", {
                space: shortSpaceId(spaceUuid),
                peer,
            });
            host.dispatchRunEventForRun?.(existing, { type: "ensure" });
            return;
        }

        const livePhase = host.liveSnapshot(existing).phase;
        const inProgress =
            livePhase === "ensuring" ||
            livePhase === "creating" ||
            livePhase === "joining" ||
            livePhase === "waiting-peer" ||
            livePhase === "signaling";

        if (inProgress) {
            if (
                existing.snapshot.sessionId &&
                !existing.snapshot.signalingJoined &&
                peerOnline
            ) {
                avCallLog("ensureDmAvCallSession resume in-progress", {
                    space: shortSpaceId(spaceUuid),
                    peer,
                });
                host.dispatchRunEventForRun?.(existing, { type: "ensure" });
            } else if (
                existing.snapshot.sessionId &&
                !existing.snapshot.mediaConnected &&
                existing.hasJoined &&
                existing.peer &&
                peerOnline &&
                self &&
                shouldInitiateOffer(self, peer)
            ) {
                avCallLog("ensureDmAvCallSession resendOffer (peer online)", {
                    space: shortSpaceId(spaceUuid),
                    peer,
                    sessionId: shortSessionId(existing.snapshot.sessionId),
                });
                existing.peer.resendOffer();
            }
            return;
        }

        if (
            existing.snapshot.phase === "ready" ||
            existing.snapshot.phase === "failed"
        ) {
            existing.abort.abort();
            host.tearDownDmPeer(existing, "restarting session");
            host.deleteRun(spaceUuid);
        } else {
            return;
        }
    }

    avCallLog("ensureDmAvCallSession start", {
        space: shortSpaceId(spaceUuid),
        peer,
    });

    const abort = new AbortController();
    const run: DmAvCallRun = {
        kind: "dm",
        spaceUuid,
        members: [...members],
        peerAccount: peer,
        wantVideo: DEFAULT_WANT_VIDEO,
        wantAudio: DEFAULT_WANT_AUDIO,
        peer: null,
        abort,
        snapshot: {
            spaceUuid,
            phase: "ensuring",
            signalingJoined: false,
            mediaConnected: false,
        },
        hasJoined: false,
        transportRecoveryAttempt: 0,
        onUpdate: () => {
            host.onSpaceUpdate?.(spaceUuid, host.liveSnapshot(run));
        },
    };
    host.setRun(spaceUuid, run);
    run.onUpdate();
    host.dispatchRunEventForRun?.(run, { type: "ensure" });
}

export function startDmAvCallPeer(
    host: AvCallOrchestratorHost,
    run: DmAvCallRun,
    sessionId: string,
    self: string,
    isInitiator: boolean,
): void {
    const signaling = host.getSignaling();
    if (!signaling && !host.usesSharedTransport?.()) return;

    const existing = run.peer;
    if (shouldReuseMeetPeer(host, existing, sessionId)) {
        avCallLog("startDmAvCallPeer: reuse existing peer", {
            sessionId: shortSessionId(sessionId),
            mediaConnected: existing!.isMediaConnected,
            isInitiator,
            sharedPc: host.usesSharedTransport?.() ?? false,
        });
        if (existing!.isMediaConnected) {
            host.dispatchRunEventForRun?.(run, {
                type: "mediaConnected",
                remoteAccount: run.peerAccount,
            });
            const local = existing!.getLocalStream();
            if (local) {
                host.onAvCallMediaReady?.(run.spaceUuid, {
                    peerAccount: run.peerAccount,
                    localStream: local,
                    remoteStream: existing!.getRemoteStream() ?? null,
                });
            }
            run.onUpdate();
        }
        return;
    }
    host.tearDownDmPeer(run, "replacing peer");

    run.peer = createMeetPeerForRemote({
        host,
        remoteAccount: run.peerAccount,
        avCallSessionId: sessionId,
        selfAccount: self,
        isInitiator,
        wantVideo: run.wantVideo,
        wantAudio: run.wantAudio,
        handlers: {
            onMediaConnected: () => {
                host.dispatchRunEventForRun?.(run, {
                    type: "mediaConnected",
                    remoteAccount: run.peerAccount,
                });
                const local = run.peer?.getLocalStream();
                if (local) {
                    host.onAvCallMediaReady?.(run.spaceUuid, {
                        peerAccount: run.peerAccount,
                        localStream: local,
                        remoteStream: run.peer?.getRemoteStream() ?? null,
                    });
                }
                run.onUpdate();
            },
            onLocalStream: () => {
                /* UI hooks via onAvCallMediaReady on connect */
            },
            onRemoteStream: (remote) => {
                if (!remote || !run.snapshot.mediaConnected) return;
                host.promoteAvCallParticipantToJoined?.(
                    sessionId,
                    run.peerAccount,
                );
                const local = run.peer?.getLocalStream();
                if (local) {
                    host.onAvCallMediaReady?.(run.spaceUuid, {
                        peerAccount: run.peerAccount,
                        localStream: local,
                        remoteStream: remote,
                    });
                }
                run.onUpdate();
            },
            onFailed: (detail) => {
                host.fail(run, detail);
            },
            onTransportLost: (detail) => {
                if (run.snapshot.mediaConnected) {
                    host.tearDownDmPeer(run, detail);
                    const sessionId = run.snapshot.sessionId;
                    if (sessionId) {
                        host.setPhase(run, "waiting-peer", {
                            sessionId,
                            mediaConnected: false,
                        });
                    }
                    return;
                }
                host.fail(run, avCallConnectivityErrorMessage(detail));
            },
        },
    });

    void run.peer.start().catch((e) => {
        const detail =
            e instanceof Error ? e.message : "av-call media start failed";
        host.fail(run, detail);
    });
}

export function beginSignalingDmAvCallSkipChecks(
    host: AvCallOrchestratorHost,
    run: DmAvCallRun,
    sessionId: string,
): boolean {
    const phase = host.liveSnapshot(run).phase;
    if (
        run.hasJoined &&
        run.peer?.isMediaConnected &&
        phase === "ready" &&
        run.snapshot.sessionId === sessionId
    ) {
        avCallLog("beginSignaling skipped (already active)", {
            sessionId: shortSessionId(sessionId),
        });
        return true;
    }
    if (
        run.hasJoined &&
        run.peer &&
        !run.peer.isDisposed &&
        run.snapshot.sessionId === sessionId &&
        !run.peer.isMediaConnected &&
        (phase === "signaling" || phase === "joining")
    ) {
        avCallLog("beginSignaling skipped (negotiation in flight)", {
            sessionId: shortSessionId(sessionId),
            space: shortSpaceId(run.spaceUuid),
        });
        return true;
    }
    return false;
}

export function beginSignalingDmAvCall(
    host: AvCallOrchestratorHost,
    run: DmAvCallRun,
    sessionId: string,
    self: string,
): void {
    if (beginSignalingDmAvCallSkipChecks(host, run, sessionId)) {
        return;
    }

    const isInitiator = shouldInitiateOffer(self, run.peerAccount);
    const mustJoin = !run.hasJoined || !run.peer;
    avCallLog("beginSignaling", {
        space: shortSpaceId(run.spaceUuid),
        sessionId: shortSessionId(sessionId),
        peer: run.peerAccount,
        isInitiator,
        mustJoin,
    });

    const signaling = host.getSignaling();
    if (mustJoin && signaling) {
        signaling.joinSession(sessionId);
        run.hasJoined = true;
        commitAvCallJoin(sessionId);
        run.snapshot = {
            ...run.snapshot,
            sessionId,
            signalingJoined: true,
        };
    }

    startDmAvCallPeer(host, run, sessionId, self, isInitiator);
}

export function declineDmAvCallInvite(
    host: AvCallOrchestratorHost,
    run: DmAvCallRun,
    reason: string,
): void {
    const terminalReason = normalizeAvCallTerminalReason(reason);
    avCallRecord("declineInvite", {
        space: shortSpaceId(run.spaceUuid),
        sessionId: run.snapshot.sessionId
            ? shortSessionId(run.snapshot.sessionId)
            : undefined,
        reason: terminalReason,
    });
    const sessionId = run.snapshot.sessionId;
    if (sessionId) {
        host.onInviteCleared?.(sessionId);
    }
    const signaling = host.getSignaling();
    if (sessionId && signaling && !run.hasJoined) {
        signaling.joinSession(sessionId);
        run.hasJoined = true;
    }
    host.tearDownSignaling(run, terminalReason);
    if (sessionId) {
        host.setPhase(run, "failed", {
            sessionId,
            lastError: terminalReason,
            signalingJoined: false,
            mediaConnected: false,
        });
    }
    host.deleteRun(run.spaceUuid);
}

export function tearDownDmAvCallPeer(
    host: AvCallOrchestratorHost,
    run: DmAvCallRun,
    reason: string,
): void {
    avCallRecord("tearDownDmPeer", {
        space: shortSpaceId(run.spaceUuid),
        reason,
        hadPeer: !!run.peer,
    });
    run.peer?.dispose();
    run.peer = null;
    if (run.snapshot.mediaConnected) {
        run.snapshot = {
            ...run.snapshot,
            mediaConnected: false,
        };
        run.onUpdate();
    }
}
