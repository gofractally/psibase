import { chatDataLog, chatDataRecord, shortSessionId, shortSpaceId } from "./chat-data-debug";
import { ensureConnection } from "./chat-data-connection-reconciler";
import {
    dmPeerAccount,
    shouldInitiateOffer,
    type ChatDataOrchestratorHost,
    type DmSpaceRun,
} from "./chat-data-session-types";
import { initialRunSnapshot } from "./chat-data-run-state-machine";

/**
 * Phase A reconciler: this helper is intentionally tiny. It only creates the
 * run record if absent, then dispatches a single `ensure` event into the
 * per-run actor. ALL decisions about whether to (re)negotiate, resend
 * offers, dispose stale peers, or restart the pipeline live in the FSM
 * `transition` function. Anything else here is a bug — there should be no
 * imperative `if (snapshot.phase === ...)` ladders parallel to the FSM.
 */
export function ensureDmChatDataSession(
    host: ChatDataOrchestratorHost,
    spaceUuid: string,
    members: readonly string[],
): void {
    const self = host.getSelf();
    if (!self) return;

    const peerAccount = dmPeerAccount(members, self);
    if (!peerAccount) return;

    let run = host.getRun(spaceUuid);
    if (run?.kind === "group") {
        // Membership drift (DM ↔ group). Switch to the group code path; it
        // owns its own reconciler and will fan out an `ensure` of its own.
        host.ensureGroupChatDataSession(spaceUuid, members);
        return;
    }

    if (!run) {
        const dmRun: DmSpaceRun = {
            kind: "dm",
            spaceUuid,
            members: [...members],
            peerAccount,
            peerWasOnlineAtSessionStart:
                host.getPeerPresence()[peerAccount] === "online",
            abort: new AbortController(),
            transportRecoveryAttempt: 0,
            snapshot: initialRunSnapshot({
                spaceUuid,
                kind: "dm",
                members,
                self,
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
                host.onSpaceUpdate?.(spaceUuid, dmRun.snapshot);
            },
        };
        run = dmRun;
        host.setRun(spaceUuid, run);
        chatDataLog("ensureDmChatDataSession", {
            space: shortSpaceId(spaceUuid),
            peer: peerAccount,
            new: true,
        });
        run.onUpdate();
    } else {
        chatDataLog("ensureDmChatDataSession", {
            space: shortSpaceId(spaceUuid),
            peer: peerAccount,
            phase: run.snapshot.phase,
        });
    }

    host.dispatchRunEventForRun(run, { type: "ensure" });
}

/**
 * Phase C: thin wrapper around the unified
 * {@link ensureConnection} reconciler. Kept as a named export for
 * call-site readability — DM callers want a name that says "DM peer".
 *
 * The `isInitiator` argument is ignored by the reconciler (it derives
 * polite/impolite from account ordering, matching what we used to pass
 * here). It's kept on the signature so external test mocks that still
 * pass it don't break.
 */
export function startDmPeer(
    host: ChatDataOrchestratorHost,
    run: DmSpaceRun,
    sessionId: string,
    self: string,
    _isInitiator?: boolean,
): void {
    ensureConnection(host, run, sessionId, self, run.peerAccount);
}

export function releaseIdleDmTransport(
    host: ChatDataOrchestratorHost,
    spaceUuid: string,
): void {
    const run = host.getRun(spaceUuid);
    if (!run || run.kind === "group") return;
    chatDataRecord("releaseIdleTransport", {
        space: shortSpaceId(spaceUuid),
        phase: run.snapshot.phase,
    });
    const signaling = host.getSignaling();
    if (signaling && run.hasJoined && run.snapshot.sessionId) {
        signaling.leaveSession(run.snapshot.sessionId, "pending-drained");
    }
    host.tearDownTransport(run, "pending queue drained");
    run.hasJoined = false;
    run.joinSessionRequested = false;
    if (run.snapshot.sessionId) {
        host.dispatchRunEventForRun(run, {
            type: "signalingDeferred",
            sessionId: run.snapshot.sessionId,
        });
    }
}

/**
 * Idempotent: joins the session if we haven't, ensures a peer exists for the
 * remote, and lets the WebRTC peer drive negotiation. Safe to call on any
 * event that *might* warrant transport progress; the function decides
 * internally whether anything needs to happen.
 */
export function beginSignalingDm(
    host: ChatDataOrchestratorHost,
    run: DmSpaceRun,
    sessionId: string,
    self: string,
): void {
    const isInitiator = shouldInitiateOffer(self, run.peerAccount);
    const peerReusable =
        !!run.peer &&
        !run.peer.isDisposed &&
        run.peer.sessionId === sessionId;
    const welcomeGeneration = host.getRealtime()?.welcomeGeneration ?? 0;
    const mustRequestJoin =
        !run.hasJoined ||
        run.joinedWelcomeGeneration !== welcomeGeneration;
    chatDataLog("beginSignaling", {
        space: shortSpaceId(run.spaceUuid),
        sessionId: shortSessionId(sessionId),
        peer: run.peerAccount,
        isInitiator,
        hasJoined: run.hasJoined,
        joinSessionRequested: run.joinSessionRequested,
        mustRequestJoin,
        peerReusable,
    });

    const signaling = host.getSignaling();
    if (mustRequestJoin && signaling) {
        signaling.joinSession(sessionId);
        run.joinSessionRequested = true;
        run.joinedWelcomeGeneration = welcomeGeneration;
    }

    // Join the x-webrtcsig roster early (see sessionResolved DM path) but do
    // not open a PC until the remote is online — offers sent while they are
    // offline are dropped when roster / initiator state changes on rejoin.
    if (host.getPeerPresence()[run.peerAccount] !== "online") {
        host.syncRunSnapshot(run);
        return;
    }

    startDmPeer(host, run, sessionId, self, isInitiator);
    host.syncRunSnapshot(run);
}
