import { chatDataLog, shortSessionId, shortSpaceId } from "./chat-data-debug";
import {
    ensureConnection,
    releaseConnection,
} from "./chat-data-connection-reconciler";
import {
    isGroupMembers,
    remoteMembers,
    type ChatDataOrchestratorHost,
    type GroupSpaceRun,
} from "./chat-data-session-types";
import { initialRunSnapshot } from "./chat-data-run-state-machine";

export function allOnlineMeshPeersReady(
    host: ChatDataOrchestratorHost,
    run: GroupSpaceRun,
): boolean {
    const self = host.getSelf();
    if (!self) return false;
    const onlineRemotes = remoteMembers(run.members, self).filter(
        (member) => host.getPeerPresence()[member] === "online",
    );
    if (onlineRemotes.length === 0) return false;
    return onlineRemotes.every(
        (member) => run.meshPeers.get(member)?.dataChannelReady === true,
    );
}

/**
 * Phase C: thin wrapper around the unified per-connection teardown.
 * Kept as a named export so call sites that want a name describing
 * mesh-peer scope (vs. e.g. the whole run's transport) remain readable.
 */
export function tearDownMeshPeer(
    host: ChatDataOrchestratorHost,
    run: GroupSpaceRun,
    remoteAccount: string,
    reason: string,
): void {
    releaseConnection(host, run, remoteAccount, reason);
}

/**
 * Phase A reconciler: same contract as `ensureDmChatDataSession`. Create
 * the run if absent; then dispatch a single `ensure` event into the actor.
 * Anything else is the FSM's job.
 */
export function ensureGroupChatDataSession(
    host: ChatDataOrchestratorHost,
    spaceUuid: string,
    members: readonly string[],
): void {
    const self = host.getSelf();
    if (!self || !isGroupMembers(members)) return;

    let run = host.getRun(spaceUuid);
    if (run?.kind === "dm") {
        // Membership drift (DM ↔ group); the DM orchestrator owns this
        // space's lifecycle. Refuse to take over.
        return;
    }

    if (!run) {
        const remotes = remoteMembers(members, self);
        const presence = host.getPeerPresence();
        const peerOnlineAtSessionStart = new Map<string, boolean>();
        const peerHadOpenDataChannel = new Map<string, boolean>();
        for (const m of remotes) {
            peerOnlineAtSessionStart.set(m, presence[m] === "online");
            peerHadOpenDataChannel.set(m, false);
        }
        const groupRun: GroupSpaceRun = {
            kind: "group",
            spaceUuid,
            members: [...members],
            meshPeers: new Map(),
            peerOnlineAtSessionStart,
            peerHadOpenDataChannel,
            abort: new AbortController(),
            transportRecoveryAttempt: 0,
            snapshot: initialRunSnapshot({
                spaceUuid,
                kind: "group",
                members,
                self,
            }),
            hasJoined: false,
            joinSessionRequested: false,
            joinedWelcomeGeneration: 0,
            sessionRoster: new Map(),
            sessionSnapshotEpoch: 0,
            transportLostAt: new Map(),
            lastMeshNudgeMs: 0,
            onUpdate: () => {
                host.onSpaceUpdate?.(spaceUuid, groupRun.snapshot);
            },
        };
        run = groupRun;
        host.setRun(spaceUuid, run);
        chatDataLog("ensureGroupChatDataSession", {
            space: shortSpaceId(spaceUuid),
            memberCount: members.length,
            new: true,
        });
        run.onUpdate();
    } else {
        chatDataLog("ensureGroupChatDataSession", {
            space: shortSpaceId(spaceUuid),
            memberCount: members.length,
            phase: run.snapshot.phase,
        });
    }

    host.dispatchRunEventForRun(run, { type: "ensure" });
}

/**
 * Phase C: walk the mesh, ensuring exactly one connection per online
 * remote and tearing down any connection for an offline remote. Each
 * decision flows through {@link ensureConnection} so DM and group share
 * the same "reuse or rebuild" semantics.
 *
 * Plan F7 — gating on the server-authoritative roster.
 *   Before F1 we'd create a peer for every member presumed online from
 *   the local presence map. The result: at session creation time we
 *   built peers with `rosterSize: 0`, forced to use the lex-order
 *   initiator fallback, often producing double-offers and ICE churn
 *   that resolved only via Perfect Negotiation glare handling. Now we
 *   only ensure a peer for remotes that the server says are joined
 *   (i.e. present in `run.sessionRoster`). A remote that is presence-
 *   online but has not joined yet will be picked up by the
 *   `participantJoined` / `rosterUpdated` events, which both trigger
 *   another `beginSignaling` pass — at which point the roster has
 *   their entry with the right `joinedAt` and the F2 initiator rule
 *   produces the correct, single-offer outcome.
 */
export function syncMeshPeers(
    host: ChatDataOrchestratorHost,
    run: GroupSpaceRun,
    sessionId: string,
    self: string,
): void {
    const presence = host.getPeerPresence();
    const rosterReady = run.sessionRoster.size > 0;
    for (const remote of remoteMembers(run.members, self)) {
        if (presence[remote] !== "online") {
            tearDownMeshPeer(host, run, remote, "peer offline");
            continue;
        }
        const existing = run.meshPeers.get(remote);
        if (
            existing &&
            !existing.isDisposed &&
            existing.sessionId !== sessionId
        ) {
            chatDataLog("syncMeshPeers: peer session id drift", {
                space: shortSpaceId(run.spaceUuid),
                remote,
                was: shortSessionId(existing.sessionId),
                now: shortSessionId(sessionId),
            });
            tearDownMeshPeer(host, run, remote, "session id changed");
        } else if (existing?.dataChannelReady) {
            continue;
        } else if (
            existing &&
            !existing.isDisposed &&
            existing.needsReconnect
        ) {
            tearDownMeshPeer(host, run, remote, "stale peer");
        }
        // Only create a peer once the server has confirmed (via
        // sessionSnapshot/participantJoined) that the remote has joined
        // the same session. Pre-roster, the join is pending and we'd
        // make a wrong-initiator guess that doubles signaling work.
        if (rosterReady && !run.sessionRoster.has(remote)) continue;
        if (rosterReady && !run.sessionRoster.has(self)) continue;
        if (!rosterReady) continue;
        ensureConnection(host, run, sessionId, self, remote);
    }
    host.syncRunSnapshot(run);
}

/**
 * Phase C: thin wrapper around {@link ensureConnection}, exported for
 * existing call sites that want a name scoped to the group mesh.
 */
export function startMeshPeer(
    host: ChatDataOrchestratorHost,
    run: GroupSpaceRun,
    sessionId: string,
    self: string,
    remoteAccount: string,
): void {
    ensureConnection(host, run, sessionId, self, remoteAccount);
}

function groupMeshHasLiveDataChannel(run: GroupSpaceRun): boolean {
    for (const peer of run.meshPeers.values()) {
        if (!peer.isDisposed && peer.dataChannelReady) return true;
    }
    return false;
}

export function beginSignalingGroup(
    host: ChatDataOrchestratorHost,
    run: GroupSpaceRun,
    sessionId: string,
    self: string,
): void {
    const welcomeGeneration = host.getRealtime()?.welcomeGeneration ?? 0;
    const signaling = host.getSignaling();
    if (
        run.hasJoined &&
        run.joinedWelcomeGeneration !== welcomeGeneration &&
        !groupMeshHasLiveDataChannel(run)
    ) {
        for (const remote of remoteMembers(run.members, self)) {
            tearDownMeshPeer(host, run, remote, "welcome generation drift");
        }
        run.hasJoined = false;
        run.joinSessionRequested = false;
        chatDataLog("beginSignaling group mesh: welcome drift (stale mesh cleared)", {
            space: shortSpaceId(run.spaceUuid),
            sessionId: shortSessionId(sessionId),
            welcomeGeneration,
            joinedWelcomeGeneration: run.joinedWelcomeGeneration,
        });
    }
    if (
        run.hasJoined &&
        run.joinedWelcomeGeneration !== welcomeGeneration &&
        groupMeshHasLiveDataChannel(run) &&
        signaling
    ) {
        chatDataLog("beginSignaling group mesh: welcome refresh (live mesh)", {
            space: shortSpaceId(run.spaceUuid),
            sessionId: shortSessionId(sessionId),
            welcomeGeneration,
            joinedWelcomeGeneration: run.joinedWelcomeGeneration,
        });
        signaling.joinSession(sessionId);
        run.joinSessionRequested = true;
        run.hasJoined = false;
        syncMeshPeers(host, run, sessionId, self);
        host.syncRunSnapshot(run);
        return;
    }
    const mustRequestJoin =
        !run.hasJoined ||
        run.joinedWelcomeGeneration !== welcomeGeneration;
    chatDataLog("beginSignaling group mesh", {
        space: shortSpaceId(run.spaceUuid),
        sessionId: shortSessionId(sessionId),
        hasJoined: run.hasJoined,
        mustRequestJoin,
        welcomeGeneration,
        joinedWelcomeGeneration: run.joinedWelcomeGeneration,
    });
    if (mustRequestJoin && signaling) {
        signaling.joinSession(sessionId);
        run.joinSessionRequested = true;
        run.joinedWelcomeGeneration = welcomeGeneration;
    }
    syncMeshPeers(host, run, sessionId, self);
    host.syncRunSnapshot(run);
}
