import {
    avCallLog,
    avCallRecord,
    shortSessionId,
    shortSpaceId,
} from "./av-call-debug";
import { normalizeAvCallTerminalReason } from "./av-call-terminal";
import { commitAvCallJoin } from "./av-call-timeline-commit";
import { MeetWebRtcPeer } from "./meet-webrtc-peer";
import { acquireMeetLocalMedia } from "./local-media";
import {
    avCallConnectivityErrorMessage,
    isGroupMembers,
    remoteMembers,
    shouldInitiateOffer,
    type AvCallOrchestratorHost,
    type GroupAvCallRun,
} from "./av-call-session-types";

const DEFAULT_WANT_VIDEO = true;
const DEFAULT_WANT_AUDIO = true;

export function tearDownMeshAvCallPeer(
    host: AvCallOrchestratorHost,
    run: GroupAvCallRun,
    remoteAccount: string,
    reason: string,
): void {
    const peer = run.meshPeers.get(remoteAccount);
    if (!peer) return;
    avCallRecord("tearDownMeshAvCallPeer", {
        space: shortSpaceId(run.spaceUuid),
        remote: remoteAccount,
        reason,
    });
    peer.dispose();
    run.meshPeers.delete(remoteAccount);
    if (run.meshPeers.size === 0) {
        tearDownGroupLocalMedia(run);
    }
    run.snapshot = {
        ...host.liveSnapshot(run),
        meshPeerSignalingReady: host.meshPeerSignalingReadyMap(run),
    };
    run.onUpdate();
}

export function tearDownGroupLocalMedia(run: GroupAvCallRun): void {
    if (!run.localStream) return;
    for (const t of run.localStream.getTracks()) {
        t.stop();
    }
    run.localStream = null;
}

export async function ensureGroupLocalMedia(
    run: GroupAvCallRun,
): Promise<MediaStream | null> {
    if (run.localStream) return run.localStream;
    try {
        const { stream } = await acquireMeetLocalMedia(
            run.wantVideo,
            run.wantAudio,
        );
        run.localStream = stream;
        return stream;
    } catch (e) {
        const detail =
            e instanceof Error ? e.message : "Could not start av-call media";
        throw new Error(detail);
    }
}

export function ensureGroupAvCallSession(
    host: AvCallOrchestratorHost,
    spaceUuid: string,
    members: readonly string[],
): void {
    const self = host.getSelf();
    if (!self || !isGroupMembers(members)) return;

    avCallLog("ensureGroupAvCallSession", {
        space: shortSpaceId(spaceUuid),
        memberCount: members.length,
    });

    const remotes = remoteMembers(members, self);
    const presence = host.getPeerPresence();
    const onlineRemotes = remotes.filter((m) => presence[m] === "online");

    const existing = host.getRun(spaceUuid);
    if (existing?.kind === "group") {
        const allOnlineMediaReady =
            onlineRemotes.length > 0 &&
            onlineRemotes.every((m) => runMeshPeerMediaReady(existing, m));
        if (allOnlineMediaReady && existing.snapshot.signalingJoined) {
            return;
        }

        const waitingForAnyOnline =
            onlineRemotes.length === 0 &&
            existing.snapshot.phase === "waiting-peer";
        if (
            waitingForAnyOnline ||
            existing.snapshot.phase === "ensuring" ||
            existing.snapshot.phase === "creating" ||
            existing.snapshot.phase === "joining" ||
            existing.snapshot.phase === "signaling"
        ) {
            if (existing.snapshot.sessionId && onlineRemotes.length > 0) {
                void host.beginSignaling(
                    existing,
                    existing.snapshot.sessionId,
                );
            }
            return;
        }

        if (
            existing.snapshot.phase === "ready" ||
            existing.snapshot.phase === "failed"
        ) {
            existing.abort.abort();
            for (const peer of existing.meshPeers.values()) {
                peer.dispose();
            }
            existing.meshPeers.clear();
            tearDownGroupLocalMedia(existing);
            host.deleteRun(spaceUuid);
        } else if (existing.snapshot.sessionId) {
            void host.beginSignaling(
                existing,
                existing.snapshot.sessionId,
            );
            return;
        }
    } else if (existing?.kind === "dm") {
        return;
    }

    const peerOnlineAtSessionStart = new Map<string, boolean>();
    for (const m of remotes) {
        peerOnlineAtSessionStart.set(m, presence[m] === "online");
    }

    const abort = new AbortController();
    const run: GroupAvCallRun = {
        kind: "group",
        spaceUuid,
        members: [...members],
        meshPeers: new Map(),
        wantVideo: DEFAULT_WANT_VIDEO,
        wantAudio: DEFAULT_WANT_AUDIO,
        localStream: null,
        peerOnlineAtSessionStart,
        abort,
        snapshot: {
            spaceUuid,
            phase: "ensuring",
            signalingJoined: false,
            meshPeerSignalingReady: {},
        },
        hasJoined: false,
        transportRecoveryAttempt: 0,
        onUpdate: () => {
            host.onSpaceUpdate?.(spaceUuid, host.liveSnapshot(run));
        },
    };
    host.setRun(spaceUuid, run);
    avCallLog("group runPipeline start", {
        space: shortSpaceId(spaceUuid),
        onlineRemotes: onlineRemotes.length,
    });
    run.onUpdate();
    void host.runPipeline(run);
}

function runMeshPeerMediaReady(run: GroupAvCallRun, remote: string): boolean {
    return run.meshPeers.get(remote)?.isMediaConnected ?? false;
}

export function syncMeshAvCallPeers(
    host: AvCallOrchestratorHost,
    run: GroupAvCallRun,
    sessionId: string,
    self: string,
): void {
    const presence = host.getPeerPresence();
    for (const remote of remoteMembers(run.members, self)) {
        if (presence[remote] !== "online") {
            tearDownMeshAvCallPeer(host, run, remote, "peer offline");
            continue;
        }
        if (runMeshPeerMediaReady(run, remote)) continue;
        startMeshAvCallPeer(host, run, sessionId, self, remote);
    }
    run.snapshot = {
        ...host.liveSnapshot(run),
        meshPeerSignalingReady: host.meshPeerSignalingReadyMap(run),
    };
    run.onUpdate();
}

export function startMeshAvCallPeer(
    host: AvCallOrchestratorHost,
    run: GroupAvCallRun,
    sessionId: string,
    self: string,
    remoteAccount: string,
): void {
    const signaling = host.getSignaling();
    if (!signaling || !run.localStream) return;

    const existing = run.meshPeers.get(remoteAccount);
    if (
        existing &&
        existing.sessionId === sessionId &&
        !existing.isDisposed
    ) {
        avCallLog("startMeshAvCallPeer: reuse existing peer", {
            remote: remoteAccount,
            sessionId: shortSessionId(sessionId),
            mediaConnected: existing.isMediaConnected,
        });
        return;
    }
    existing?.dispose();
    run.meshPeers.delete(remoteAccount);

    const isInitiator = shouldInitiateOffer(self, remoteAccount);
    const peer = new MeetWebRtcPeer({
        sessionId,
        selfAccount: self,
        peerAccount: remoteAccount,
        iceServers: host.getIceServers(),
        signaling,
        isInitiator,
        wantVideo: run.wantVideo,
        wantAudio: run.wantAudio,
        sharedLocalStream: run.localStream,
        handlers: {
            onMediaConnected: () => {
                run.snapshot = {
                    ...host.liveSnapshot(run),
                    phase: "ready",
                    meshPeerSignalingReady:
                        host.meshPeerSignalingReadyMap(run),
                };
                run.onUpdate();
                const local = run.localStream ?? peer.getLocalStream();
                if (local) {
                    host.onAvCallMediaReady?.(run.spaceUuid, {
                        peerAccount: remoteAccount,
                        localStream: local,
                        remoteStream: peer.getRemoteStream(),
                    });
                }
            },
            onRemoteStream: (remote) => {
                if (!remote) return;
                const local = run.localStream ?? peer.getLocalStream();
                if (local && peer.isMediaConnected) {
                    host.onAvCallMediaReady?.(run.spaceUuid, {
                        peerAccount: remoteAccount,
                        localStream: local,
                        remoteStream: remote,
                    });
                }
            },
            onFailed: (detail) => {
                tearDownMeshAvCallPeer(host, run, remoteAccount, detail);
                run.onUpdate();
            },
            onTransportLost: (detail) => {
                tearDownMeshAvCallPeer(host, run, remoteAccount, detail);
                const anyMediaConnected = [...run.meshPeers.values()].some(
                    (p) => p.isMediaConnected,
                );
                if (
                    !anyMediaConnected &&
                    run.meshPeers.size === 0 &&
                    (run.snapshot.phase === "signaling" ||
                        run.snapshot.phase === "joining")
                ) {
                    host.fail(run, avCallConnectivityErrorMessage(detail));
                    return;
                }
                run.onUpdate();
            },
        },
    });
    run.meshPeers.set(remoteAccount, peer);
    run.snapshot = {
        ...host.liveSnapshot(run),
        meshPeerSignalingReady: host.meshPeerSignalingReadyMap(run),
    };
    run.onUpdate();

    avCallLog("startMeshAvCallPeer", {
        space: shortSpaceId(run.spaceUuid),
        remote: remoteAccount,
        sessionId: shortSessionId(sessionId),
        isInitiator,
    });

    void peer.start().catch((e) => {
        const detail =
            e instanceof Error ? e.message : "av-call media start failed";
        host.fail(run, detail);
    });
}

export function beginSignalingGroupAvCallSkipChecks(
    run: GroupAvCallRun,
    sessionId: string,
): boolean {
    if (
        run.hasJoined &&
        run.snapshot.signalingJoined &&
        run.snapshot.sessionId === sessionId &&
        (run.snapshot.phase === "signaling" || run.snapshot.phase === "ready")
    ) {
        const onlineRemotes = [...run.meshPeers.values()].filter(
            (p) => !p.isDisposed,
        );
        if (onlineRemotes.length > 0 && onlineRemotes.every((p) => p.isMediaConnected)) {
            avCallLog("beginSignaling group skipped (all mesh media ready)", {
                sessionId: shortSessionId(sessionId),
                meshPeers: onlineRemotes.length,
            });
            return true;
        }
    }
    if (
        run.hasJoined &&
        run.snapshot.sessionId === sessionId &&
        !run.snapshot.signalingJoined &&
        (run.snapshot.phase === "signaling" ||
            run.snapshot.phase === "joining")
    ) {
        avCallLog("beginSignaling group skipped (join in flight)", {
            sessionId: shortSessionId(sessionId),
            space: shortSpaceId(run.spaceUuid),
        });
        return true;
    }
    return false;
}

export async function beginSignalingGroupAvCall(
    host: AvCallOrchestratorHost,
    run: GroupAvCallRun,
    sessionId: string,
    self: string,
): Promise<void> {
    if (beginSignalingGroupAvCallSkipChecks(run, sessionId)) {
        return;
    }

    const mustJoin = !run.hasJoined;
    avCallLog("beginSignaling group mesh", {
        space: shortSpaceId(run.spaceUuid),
        sessionId: shortSessionId(sessionId),
        mustJoin,
    });

    host.setPhase(run, "joining", { sessionId });

    const signaling = host.getSignaling();
    if (mustJoin && signaling) {
        signaling.joinSession(sessionId);
        run.hasJoined = true;
        commitAvCallJoin(sessionId);
        run.snapshot = {
            ...run.snapshot,
            signalingJoined: true,
        };
    }

    try {
        await ensureGroupLocalMedia(run);
    } catch (e) {
        const detail =
            e instanceof Error ? e.message : "av-call media start failed";
        host.fail(run, detail);
        return;
    }
    if (run.abort.signal.aborted) return;
    syncMeshAvCallPeers(host, run, sessionId, self);
    host.setPhase(run, "signaling", { sessionId });
}

export function declineGroupAvCallInvite(
    host: AvCallOrchestratorHost,
    run: GroupAvCallRun,
    reason: string,
): void {
    const terminalReason = normalizeAvCallTerminalReason(reason);
    avCallRecord("declineGroupInvite", {
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
    for (const peer of run.meshPeers.values()) {
        peer.dispose();
    }
    run.meshPeers.clear();
    tearDownGroupLocalMedia(run);
    if (sessionId) {
        host.setPhase(run, "failed", {
            sessionId,
            lastError: terminalReason,
            signalingJoined: false,
            meshPeerSignalingReady: {},
        });
    }
    host.deleteRun(run.spaceUuid);
}

/** @deprecated use tearDownMeshAvCallPeer */
export function tearDownMeshSignalingPeer(
    host: AvCallOrchestratorHost,
    run: GroupAvCallRun,
    remoteAccount: string,
    reason: string,
): void {
    tearDownMeshAvCallPeer(host, run, remoteAccount, reason);
}

/** @deprecated use syncMeshAvCallPeers */
export function syncMeshSignalingPeers(
    host: AvCallOrchestratorHost,
    run: GroupAvCallRun,
    sessionId: string,
    self: string,
): void {
    syncMeshAvCallPeers(host, run, sessionId, self);
}

/** @deprecated use startMeshAvCallPeer */
export function startMeshSignalingPeer(
    host: AvCallOrchestratorHost,
    run: GroupAvCallRun,
    sessionId: string,
    remoteAccount: string,
): void {
    const self = host.getSelf();
    if (!self) return;
    startMeshAvCallPeer(host, run, sessionId, self, remoteAccount);
}
