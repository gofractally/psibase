import { chatDataLog, shortSessionId, shortSpaceId } from "./chat-data-debug";
import type { RealtimeHandlers } from "./realtime-client";
import type { ServerRealtimeFrame } from "./realtime-protocol";
import { WebRtcSignalingClient } from "./webrtc-signaling-client";
import {
    isGroupMembers,
    type ChatDataOrchestratorHost,
    type DmSpaceRun,
    type GroupSpaceRun,
    type SpaceRun,
} from "./chat-data-session-types";
import { initialRunSnapshot } from "./chat-data-run-state-machine";

/**
 * Realtime handlers ONLY dispatch events into the per-run actor. All
 * decisions about whether to (re)join, (re)negotiate, dispose peers, etc.
 * live in the FSM transition function. This is the foundational invariant
 * that keeps the system reasoning tractable: a single source of truth.
 */
function onSessionInvite(
    host: ChatDataOrchestratorHost,
    frame: Extract<ServerRealtimeFrame, { t: "sessionInvite" }>,
): void {
    if (frame.purpose !== "chat-data") return;
    const self = host.getSelf();
    if (!self) return;

    chatDataLog("sessionInvite", {
        sessionId: shortSessionId(frame.sessionId),
        from: frame.from,
        space: shortSpaceId(frame.appMetadata.spaceUuid),
    });

    const spaceUuid = frame.appMetadata.spaceUuid;
    let run = host.getRun(spaceUuid);
    if (!run) {
        const abort = new AbortController();
        if (isGroupMembers(frame.participants)) {
            const peerOnlineAtSessionStart = new Map<string, boolean>();
            const peerHadOpenDataChannel = new Map<string, boolean>();
            const presence = host.getPeerPresence();
            for (const m of frame.participants) {
                if (m === self) continue;
                peerOnlineAtSessionStart.set(
                    m,
                    presence[m] === "online",
                );
                peerHadOpenDataChannel.set(m, false);
            }
            const groupRun: GroupSpaceRun = {
                kind: "group",
                spaceUuid,
                members: [...frame.participants],
                meshPeers: new Map(),
                peerOnlineAtSessionStart,
                peerHadOpenDataChannel,
                abort,
                transportRecoveryAttempt: 0,
                snapshot: initialRunSnapshot({
                    spaceUuid,
                    kind: "group",
                    members: frame.participants,
                    self,
                    sessionId: frame.sessionId,
                }),
                hasJoined: false,
                joinSessionRequested: false,
                joinedWelcomeGeneration: 0,
                sessionRoster: new Map(),
                sessionSnapshotEpoch: 0,
                transportLostAt: new Map(),
                lastMeshNudgeMs: 0,
                onUpdate: () => {
                    host.onSpaceUpdate?.(
                        spaceUuid,
                        groupRun.snapshot,
                    );
                },
            };
            run = groupRun;
        } else {
            const peer = frame.participants.find((p) => p !== self);
            if (!peer) return;
            const dmRun: DmSpaceRun = {
                kind: "dm",
                spaceUuid,
                members: frame.participants,
                peerAccount: peer,
                peerWasOnlineAtSessionStart:
                    host.getPeerPresence()[peer] === "online",
                abort,
                transportRecoveryAttempt: 0,
                snapshot: initialRunSnapshot({
                    spaceUuid,
                    kind: "dm",
                    members: frame.participants,
                    self,
                    sessionId: frame.sessionId,
                }),
                peer: null,
                hasJoined: false,
                joinSessionRequested: false,
                joinedWelcomeGeneration: 0,
                sessionRoster: new Map(),
                sessionSnapshotEpoch: 0,
                transportLostAt: new Map(),
                lastMeshNudgeMs: 0,
                onUpdate: () => {
                    host.onSpaceUpdate?.(
                        spaceUuid,
                        dmRun.snapshot,
                    );
                },
            };
            run = dmRun;
        }
        host.setRun(spaceUuid, run);
        host.onChatDataSessionInvite?.(spaceUuid);
    }

    if (run.snapshot.sessionId && run.snapshot.sessionId !== frame.sessionId) {
        return;
    }

    // Plan F7: the inviter is by definition a joined participant (they
    // had to call joinSession for the server to fan out this invite).
    // Treat it as a roster confirmation so the per-peer creation gating
    // in `syncMeshPeers` can act on it immediately, even when the
    // sessionSnapshot hasn't arrived yet (or never arrives because we
    // are talking to a legacy server). The snapshot will refine the
    // joinedAt later.
    if (frame.from && frame.from !== self && !run.sessionRoster.has(frame.from)) {
        ensureMonotonicRosterEntry(run, frame.from);
    }

    host.dispatchRunEventForRun(run, {
        type: "sessionInvite",
        sessionId: frame.sessionId,
        from: frame.from,
    });
}

async function onSignal(
    host: ChatDataOrchestratorHost,
    frame: Extract<ServerRealtimeFrame, { t: "signal" }>,
): Promise<void> {
    const self = host.getSelf();
    if (!self || frame.to !== self) return;

    chatDataLog("onSignal", {
        sessionId: shortSessionId(frame.sessionId),
        from: frame.from,
        kind: frame.kind,
    });

    const run = host.findRunBySessionId(frame.sessionId);
    if (!run) {
        chatDataLog("onSignal: no run for session (dropped)", {
            sessionId: shortSessionId(frame.sessionId),
            knownRuns: [...host.getRuns()].map((r) => ({
                space: shortSpaceId(r.spaceUuid),
                sessionId: r.snapshot.sessionId
                    ? shortSessionId(r.snapshot.sessionId)
                    : undefined,
            })),
        });
        return;
    }

    const from =
        frame.from ?? run.members.find((member) => member !== self);
    if (!from || from === self) {
        chatDataLog("onSignal: missing from");
        return;
    }

    await host.dispatchRunEventAndWait(run, {
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

function onSessionEnded(
    host: ChatDataOrchestratorHost,
    frame: Extract<ServerRealtimeFrame, { t: "sessionEnded" }>,
): void {
    const run = host.findRunBySessionId(frame.sessionId);
    if (!run) return;
    host.dispatchRunEventForRun(run, {
        type: "sessionEnded",
        sessionId: frame.sessionId,
        reason: frame.reason || "Session ended",
        by: frame.by,
    });
}

/**
 * F1: merge a server-authoritative roster delta into the run's local
 * `sessionRoster` map. Returns the participant accounts whose entries
 * are *newly* present so callers can decide what to do with new joiners.
 *
 * `joinedAt` uses local monotonic time at the moment the participant
 * first appeared in a snapshot. Server times would be ideal but client
 * order is good enough since the server fans out snapshots in causal
 * order over the same socket.
 *
 * When `self` is provided and several accounts arrive in one snapshot,
 * `self` is assigned the latest `joinedAt` in that batch so a client
 * opening an existing group still acts as late joiner even if the server
 * lists `self` first. Single-account batches keep server order (inviter
 * getting `[self]` alone stays earliest).
 */
function nextMonotonicJoinedAt(
    run: DmSpaceRun | GroupSpaceRun,
): number {
    if (run.sessionRoster.size === 0) {
        return Date.now();
    }
    return (
        Math.max(
            ...[...run.sessionRoster.values()].map((e) => e.joinedAt),
        ) + 1
    );
}

/** Add one roster entry with monotonic `joinedAt` (snapshot / participantJoined). */
export function ensureMonotonicRosterEntry(
    run: DmSpaceRun | GroupSpaceRun,
    account: string,
): void {
    if (run.sessionRoster.has(account)) return;
    run.sessionRoster.set(account, {
        account,
        joinedAt: nextMonotonicJoinedAt(run),
    });
}

export function mergeRosterIntoRun(
    run: DmSpaceRun | GroupSpaceRun,
    joined: readonly string[],
    pending: readonly string[],
    self?: string,
): readonly string[] {
    const newJoiners: string[] = [];
    const newcomers = joined.filter(
        (account) => !run.sessionRoster.has(account),
    );
    const assignOrder =
        self != null &&
        newcomers.includes(self) &&
        newcomers.length > 1
            ? [
                  ...newcomers.filter((account) => account !== self),
                  ...newcomers.filter((account) => account === self),
              ]
            : newcomers;
    for (const account of assignOrder) {
        run.sessionRoster.set(account, {
            account,
            joinedAt: nextMonotonicJoinedAt(run),
        });
        newJoiners.push(account);
    }
    for (const account of pending) {
        // Pending participants explicitly aren't joined yet — clear any stale
        // entry so the F2 initiator rule sees them as "not yet here".
        if (run.sessionRoster.has(account)) {
            run.sessionRoster.delete(account);
        }
    }
    // Drop any roster entries that are not in either set (the server view
    // wins; this handles the case where someone left between snapshots).
    for (const account of [...run.sessionRoster.keys()]) {
        if (!joined.includes(account) && !pending.includes(account)) {
            run.sessionRoster.delete(account);
        }
    }
    return newJoiners;
}

const TRANSPORT_LOST_SNAPSHOT_WINDOW_MS = 15_000;

/** Accept a regressive epoch when it reflects a peer we just lost transport for. */
export function shouldApplyStaleSessionSnapshot(
    run: SpaceRun,
    frame: Extract<ServerRealtimeFrame, { t: "sessionSnapshot" }>,
    now = Date.now(),
): boolean {
    if (frame.epoch > run.sessionSnapshotEpoch) return false;
    for (const account of frame.pendingParticipants) {
        const lostAt = run.transportLostAt.get(account);
        if (
            lostAt !== undefined &&
            now - lostAt <= TRANSPORT_LOST_SNAPSHOT_WINDOW_MS
        ) {
            return true;
        }
    }
    return false;
}

function applySessionSnapshot(
    host: ChatDataOrchestratorHost,
    run: SpaceRun,
    frame: Extract<ServerRealtimeFrame, { t: "sessionSnapshot" }>,
): void {
    run.sessionSnapshotEpoch = frame.epoch;
    const self = host.getSelf();
    const hadJoinedBeforeSnapshot = run.hasJoined;
    if (
        self &&
        run.hasJoined &&
        !frame.joinedParticipants.includes(self)
    ) {
        chatDataLog("sessionSnapshot: self not joined on server", {
            space: shortSpaceId(run.spaceUuid),
            sessionId: shortSessionId(frame.sessionId),
            pending: frame.pendingParticipants.includes(self),
        });
        run.hasJoined = false;
        run.joinSessionRequested = false;
        run.joinedWelcomeGeneration = 0;
        run.sessionSnapshotEpoch = 0;
    }

    const selfJoinedNow =
        !!self &&
        frame.joinedParticipants.includes(self) &&
        !hadJoinedBeforeSnapshot;
    if (self && frame.joinedParticipants.includes(self)) {
        run.hasJoined = true;
        run.joinedWelcomeGeneration =
            host.getRealtime()?.welcomeGeneration ?? run.joinedWelcomeGeneration;
        host.getSignaling()?.flushDeferredSignals(frame.sessionId);
    }

    const newJoiners = mergeRosterIntoRun(
        run,
        frame.joinedParticipants,
        frame.pendingParticipants,
        self ?? undefined,
    );
    for (const account of frame.pendingParticipants) {
        run.transportLostAt.delete(account);
    }
    chatDataLog("sessionSnapshot merged", {
        space: shortSpaceId(run.spaceUuid),
        sessionId: shortSessionId(frame.sessionId),
        rosterSize: run.sessionRoster.size,
        newJoiners,
    });
    host.dispatchRunEventForRun(run, {
        type: "rosterUpdated",
        sessionId: frame.sessionId,
        joined: frame.joinedParticipants,
        pending: frame.pendingParticipants,
        newJoiners,
    });
    if (
        self &&
        hadJoinedBeforeSnapshot &&
        !frame.joinedParticipants.includes(self)
    ) {
        host.dispatchRunEventForRun(run, {
            type: "beginSignaling",
            sessionId: frame.sessionId,
        });
    } else if (selfJoinedNow) {
        const dmPeerAlreadyLive =
            run.kind === "dm" &&
            !!run.peer &&
            !run.peer.isDisposed;
        if (!dmPeerAlreadyLive) {
            host.dispatchRunEventForRun(run, {
                type: "beginSignaling",
                sessionId: frame.sessionId,
            });
        }
        if (run.kind === "dm") {
            const peer = run.peer;
            if (peer && !peer.isDisposed && peer.sendsInitialOffer) {
                peer.resendOffer();
            }
        } else {
            for (const peer of run.meshPeers.values()) {
                if (!peer.isDisposed && peer.sendsInitialOffer) {
                    peer.resendOffer();
                }
            }
        }
    } else if (
        self &&
        frame.pendingParticipants.includes(self) &&
        !frame.joinedParticipants.includes(self)
    ) {
        // Local join was sent while another thread had focus; server still
        // lists us as pending so x-webrtcsig will not relay signals.
        chatDataLog("sessionSnapshot: self pending on server, re-join", {
            space: shortSpaceId(run.spaceUuid),
            sessionId: shortSessionId(frame.sessionId),
        });
                run.hasJoined = false;
                run.joinSessionRequested = false;
                run.joinedWelcomeGeneration = 0;
                run.sessionSnapshotEpoch = 0;
                host.dispatchRunEventForRun(run, {
                    type: "beginSignaling",
                    sessionId: frame.sessionId,
                });
    }
}

function onSessionSnapshot(
    host: ChatDataOrchestratorHost,
    frame: Extract<ServerRealtimeFrame, { t: "sessionSnapshot" }>,
): void {
    const run = host.findRunBySessionId(frame.sessionId);
    if (!run) {
        chatDataLog("sessionSnapshot: no run", {
            sessionId: shortSessionId(frame.sessionId),
        });
        return;
    }
    if (frame.epoch <= run.sessionSnapshotEpoch) {
        if (!shouldApplyStaleSessionSnapshot(run, frame)) {
            chatDataLog("sessionSnapshot: stale epoch ignored", {
                space: shortSpaceId(run.spaceUuid),
                sessionId: shortSessionId(frame.sessionId),
                epoch: frame.epoch,
                lastEpoch: run.sessionSnapshotEpoch,
            });
            return;
        }
        chatDataLog("sessionSnapshot: stale epoch applied (departure)", {
            space: shortSpaceId(run.spaceUuid),
            sessionId: shortSessionId(frame.sessionId),
            epoch: frame.epoch,
            lastEpoch: run.sessionSnapshotEpoch,
        });
    }
    applySessionSnapshot(host, run, frame);
}

function onTransportLost(
    host: ChatDataOrchestratorHost,
    frame: Extract<ServerRealtimeFrame, { t: "transportLost" }>,
): void {
    const run = host.findRunBySessionId(frame.sessionId);
    if (!run) return;
    // Roster: the lost participant is no longer joined.
    if (run.sessionRoster.has(frame.participant)) {
        run.sessionRoster.delete(frame.participant);
    }
    run.transportLostAt.set(frame.participant, Date.now());
    host.dispatchRunEventForRun(run, {
        type: "transportLost",
        sessionId: frame.sessionId,
        participant: frame.participant,
    });
}

export type RegisterRealtimeHandlersFn = (
    handlers: RealtimeHandlers,
) => () => void;

export function wireChatDataRealtimeHandlers(
    host: ChatDataOrchestratorHost,
    registerHandlers: RegisterRealtimeHandlersFn,
): (() => void) | null {
    const rt = host.getRealtime();
    if (!rt) return null;

    const signaling = new WebRtcSignalingClient(rt);
    signaling.bindSessionJoinedGate((sessionId) => {
        const run = host.findRunBySessionId(sessionId);
        return run?.hasJoined ?? false;
    });
    host.setSignaling(signaling);
    const unregister = registerHandlers({
        sessionInvite: (frame) => onSessionInvite(host, frame),
        participantJoined: (frame) => {
            const self = host.getSelf();
            if (!self || frame.participant === self) return;
            chatDataLog("participantJoined", {
                sessionId: shortSessionId(frame.sessionId),
                participant: frame.participant,
            });
            const runEarly = host.findRunBySessionId(frame.sessionId);
            // Plan F7: roster confirmation. `participantJoined` is the
            // server saying "this account has joined the session" — the
            // canonical signal the per-peer creation gating waits for.
            // Update the roster eagerly so syncMeshPeers can create the
            // peer in this same tick instead of waiting for the next
            // sessionSnapshot.
            if (runEarly && !runEarly.sessionRoster.has(frame.participant)) {
                ensureMonotonicRosterEntry(runEarly, frame.participant);
            }
            let run = runEarly;
            if (!run) {
                for (const candidate of host.getRuns()) {
                    if (!candidate.members.includes(frame.participant)) {
                        continue;
                    }
                    if (
                        candidate.snapshot.sessionId &&
                        candidate.snapshot.sessionId !== frame.sessionId
                    ) {
                        continue;
                    }
                    if (
                        candidate.kind === "dm" &&
                        candidate.peerAccount === frame.participant
                    ) {
                        run = candidate;
                        break;
                    }
                    if (candidate.kind === "group") {
                        run = candidate;
                        break;
                    }
                }
            }
            if (!run) {
                chatDataLog("participantJoined: no run for session", {
                    sessionId: shortSessionId(frame.sessionId),
                    participant: frame.participant,
                });
                return;
            }
            // Same eager-roster fallback for the by-member match path.
            if (!run.sessionRoster.has(frame.participant)) {
                ensureMonotonicRosterEntry(run, frame.participant);
            }

            host.dispatchRunEventForRun(run, {
                type: "participantJoined",
                sessionId: frame.sessionId,
                participant: frame.participant,
            });
            host.onPeerOnline(frame.participant);
        },
        signal: (frame) => {
            void onSignal(host, frame);
        },
        sessionEnded: (frame) => onSessionEnded(host, frame),
        sessionSnapshot: (frame) => onSessionSnapshot(host, frame),
        transportLost: (frame) => onTransportLost(host, frame),
        error: (frame) => {
            if (!frame.sessionId) return;
            const run = host.findRunBySessionId(frame.sessionId);
            if (!run) return;
            if (frame.code === "not-joined") {
                chatDataLog("server not-joined: re-join session", {
                    space: shortSpaceId(run.spaceUuid),
                    sessionId: shortSessionId(frame.sessionId),
                });
                run.hasJoined = false;
                run.joinSessionRequested = false;
                run.sessionSnapshotEpoch = 0;
                host.dispatchRunEventForRun(run, {
                    type: "beginSignaling",
                    sessionId: frame.sessionId,
                });
                return;
            }
            host.dispatchRunEventForRun(run, {
                type: "failed",
                detail: `${frame.code}: ${frame.reason}`.slice(0, 500),
            });
        },
    });
    chatDataLog("realtime handlers installed");
    return unregister;
}
