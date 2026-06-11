import {
    avCallLog,
    avCallRecord,
    shortSessionId,
    shortSpaceId,
} from "./av-call-debug";
import { normalizeAvCallTerminalReason } from "./av-call-terminal";
import { commitAvCallJoin } from "./av-call-timeline-commit";
import {
    createMeetPeerForRemote,
    shouldReuseMeetPeer,
} from "./av-call-meet-peer-factory";
import type { MeetPeerHandle } from "./meet-peer-handle";
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

function peerMeshMediaReady(peer: MeetPeerHandle): boolean {
    return (
        !peer.isDisposed &&
        (peer.isMediaConnected || peer.getRemoteStream() != null)
    );
}

export function reconcileGroupMeshMediaConnected(
    host: AvCallOrchestratorHost,
    run: GroupAvCallRun,
): void {
    if (
        run.awaitingInviteAccept ||
        host.isAvCallPendingInvite?.(run.spaceUuid)
    ) {
        return;
    }
    const local = run.localStream;
    for (const [remoteAccount, peer] of run.meshPeers) {
        if (peer.isDisposed) continue;
        const remoteStream = peer.getRemoteStream();
        if (!peerMeshMediaReady(peer)) continue;
        host.dispatchRunEventForRun?.(run, {
            type: "mediaConnected",
            remoteAccount,
        });
        host.onAvCallMediaReady?.(run.spaceUuid, {
            peerAccount: remoteAccount,
            localStream: local ?? peer.getLocalStream(),
            remoteStream,
        });
    }
    run.onUpdate();
}

export type EnsureGroupAvCallSessionOptions = {
    /** Host clicked Start Meet — recover stale objective session if needed. */
    hostFreshStart?: boolean;
    /** Leaver clicked Rejoin — discard local run and re-join the live session. */
    rejoinFreshStart?: boolean;
};

export function ensureGroupAvCallSession(
    host: AvCallOrchestratorHost,
    spaceUuid: string,
    members: readonly string[],
    options?: EnsureGroupAvCallSessionOptions,
): void {
    const self = host.getSelf();
    if (!self || !isGroupMembers(members)) return;

    avCallLog("ensureGroupAvCallSession", {
        space: shortSpaceId(spaceUuid),
        memberCount: members.length,
        hostFreshStart: options?.hostFreshStart ?? false,
    });

    const remotes = remoteMembers(members, self);
    const presence = host.getPeerPresence();
    const onlineRemotes = remotes.filter((m) => presence[m] === "online");

    const freshLocalRun =
        options?.hostFreshStart === true || options?.rejoinFreshStart === true;

    let existing = host.getRun(spaceUuid);
    if (existing?.kind === "group" && freshLocalRun) {
        existing.abort.abort();
        host.deleteRun(spaceUuid);
        existing = undefined;
    }
    if (existing?.kind === "group") {
        if (options?.hostFreshStart) {
            existing.hostFreshStart = true;
        }
        if (options?.rejoinFreshStart) {
            existing.rejoinFreshStart = true;
        }
        const phase = existing.snapshot.phase;
        if (
            (phase === "joining" ||
                phase === "signaling" ||
                phase === "ready") &&
            existing.hasJoined &&
            !options?.rejoinFreshStart &&
            !options?.hostFreshStart
        ) {
            return;
        }
        const allOnlineMediaReady =
            onlineRemotes.length > 0 &&
            onlineRemotes.every((m) => runMeshPeerMediaReady(existing, m));
        if (
            allOnlineMediaReady &&
            existing.snapshot.signalingJoined &&
            !options?.rejoinFreshStart &&
            !options?.hostFreshStart
        ) {
            return;
        }
        host.dispatchRunEventForRun?.(existing, { type: "ensure" });
        return;
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
        hostFreshStart: options?.hostFreshStart ?? false,
        rejoinFreshStart: options?.rejoinFreshStart ?? false,
        onUpdate: () => {
            host.onSpaceUpdate?.(spaceUuid, host.liveSnapshot(run));
        },
    };
    host.setRun(spaceUuid, run);
    run.onUpdate();
    host.dispatchRunEventForRun?.(run, { type: "ensure" });
}

function runMeshPeerMediaReady(run: GroupAvCallRun, remote: string): boolean {
    const peer = run.meshPeers.get(remote);
    return peer != null && peerMeshMediaReady(peer);
}

export function syncMeshAvCallPeers(
    host: AvCallOrchestratorHost,
    run: GroupAvCallRun,
    sessionId: string,
    self: string,
): void {
    const presence = host.getPeerPresence();
    const joinedRoster =
        host.getAvCallSessionJoinedParticipants?.(sessionId) ?? [];
    for (const remote of remoteMembers(run.members, self)) {
        const inJoinedRoster = joinedRoster.includes(remote);
        if (presence[remote] !== "online" && !inJoinedRoster) {
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
    if (
        run.awaitingInviteAccept ||
        host.isAvCallPendingInvite?.(run.spaceUuid)
    ) {
        return;
    }
    const signaling = host.getSignaling();
    if ((!signaling && !host.usesSharedTransport?.()) || !run.localStream) {
        return;
    }

    const existing = run.meshPeers.get(remoteAccount);
    if (shouldReuseMeetPeer(host, existing, sessionId)) {
        avCallLog("startMeshAvCallPeer: reuse existing peer", {
            remote: remoteAccount,
            sessionId: shortSessionId(sessionId),
            mediaConnected: existing!.isMediaConnected,
            sharedPc: host.usesSharedTransport?.() ?? false,
        });
        if (existing!.isMediaConnected) {
            host.dispatchRunEventForRun?.(run, {
                type: "mediaConnected",
                remoteAccount,
            });
            host.onAvCallMediaReady?.(run.spaceUuid, {
                peerAccount: remoteAccount,
                localStream: run.localStream ?? existing!.getLocalStream(),
                remoteStream: existing!.getRemoteStream(),
            });
            run.onUpdate();
        }
        return;
    }
    existing?.dispose();
    run.meshPeers.delete(remoteAccount);

    const isInitiator = shouldInitiateOffer(self, remoteAccount);
    const peer = createMeetPeerForRemote({
        host,
        remoteAccount,
        avCallSessionId: sessionId,
        selfAccount: self,
        isInitiator,
        wantVideo: run.wantVideo,
        wantAudio: run.wantAudio,
        sharedLocalStream: run.localStream,
        handlers: {
            onMediaConnected: () => {
                if (
                    run.awaitingInviteAccept ||
                    host.isAvCallPendingInvite?.(run.spaceUuid)
                ) {
                    return;
                }
                host.clearAvCallPendingRejoin?.(sessionId, remoteAccount);
                host.promoteAvCallParticipantToJoined?.(
                    sessionId,
                    remoteAccount,
                );
                host.dispatchRunEventForRun?.(run, {
                    type: "mediaConnected",
                    remoteAccount,
                });
                const local = run.localStream ?? peer.getLocalStream();
                const remote = peer.getRemoteStream();
                host.onAvCallMediaReady?.(run.spaceUuid, {
                    peerAccount: remoteAccount,
                    localStream: local,
                    remoteStream: remote,
                });
                run.onUpdate();
            },
            onRemoteStream: (remote) => {
                if (!remote) return;
                host.promoteAvCallParticipantToJoined?.(
                    sessionId,
                    remoteAccount,
                );
                host.onAvCallMediaReady?.(run.spaceUuid, {
                    peerAccount: remoteAccount,
                    localStream: run.localStream ?? peer.getLocalStream(),
                    remoteStream: remote,
                });
                run.onUpdate();
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
    host: AvCallOrchestratorHost,
    run: GroupAvCallRun,
    sessionId: string,
): boolean {
    if (host.isGroupMeetRejoinAttempt?.(run.spaceUuid)) {
        return false;
    }
    const phase = host.liveSnapshot(run).phase;
    if (
        run.hasJoined &&
        run.snapshot.signalingJoined &&
        run.snapshot.sessionId === sessionId &&
        (phase === "signaling" || phase === "ready")
    ) {
        const self = host.getSelf();
        if (self) {
            const pending =
                host.getAvCallSessionPendingParticipants?.(sessionId) ?? [];
            if (pending.length > 0) {
                return false;
            }
            const presence = host.getPeerPresence();
            const remotes = remoteMembers(run.members, self).filter(
                (m) => presence[m] === "online",
            );
            const allRemotesMeshed =
                remotes.length > 0 &&
                remotes.every((m) => {
                    const peer = run.meshPeers.get(m);
                    return (
                        peer !== undefined &&
                        !peer.isDisposed &&
                        peer.isMediaConnected
                    );
                });
            if (allRemotesMeshed) {
                avCallLog("beginSignaling group skipped (all mesh media ready)", {
                    sessionId: shortSessionId(sessionId),
                    meshPeers: remotes.length,
                });
                return true;
            }
        }
    }
    if (
        run.hasJoined &&
        run.snapshot.sessionId === sessionId &&
        !run.snapshot.signalingJoined &&
        (phase === "signaling" || phase === "joining")
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
    if (
        run.awaitingInviteAccept ||
        host.isAvCallPendingInvite?.(run.spaceUuid)
    ) {
        avCallLog("beginSignaling group deferred (pending invite accept)", {
            space: shortSpaceId(run.spaceUuid),
            sessionId: shortSessionId(sessionId),
        });
        return;
    }
    if (beginSignalingGroupAvCallSkipChecks(host, run, sessionId)) {
        return;
    }

    const mustJoin = !run.hasJoined;
    avCallLog("beginSignaling group mesh", {
        space: shortSpaceId(run.spaceUuid),
        sessionId: shortSessionId(sessionId),
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
        host.dispatchRunEventForRun?.(run, {
            type: "joinedSignaling",
            sessionId,
        });
        host.markGroupMeetJoined?.(run.spaceUuid, sessionId);
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
    if (host.isGroupMeetRejoinAttempt?.(run.spaceUuid)) {
        run.rejoinFreshStart = false;
    }
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
