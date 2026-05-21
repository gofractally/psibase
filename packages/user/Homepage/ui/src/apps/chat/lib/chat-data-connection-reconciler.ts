import {
    chatDataLog,
    chatDataRecord,
    shortSessionId,
    shortSpaceId,
} from "./chat-data-debug";
import { ChatDataWebRtcPeer } from "./chat-data-webrtc-peer";
import {
    isImpoliteForCollision,
    shouldInitiateOffer,
    type ChatDataOrchestratorHost,
    type SpaceRun,
} from "./chat-data-session-types";

/**
 * Phase C: a single canonical "ensure a WebRTC peer exists for
 * (sessionId, remoteAccount)" function shared by both DM and group code
 * paths. DM is treated as a mesh of one; the only difference between the
 * two is where the peer is stored on the run record.
 *
 * Why this exists: before Phase C, `startDmPeer` and `startMeshPeer` were
 * near-identical copies. Two copies → two places to drift. Two of the bugs
 * that contributed to the send-after-rejoin wedge were divergences between
 * the DM and group versions of "should we reuse the existing peer?". This
 * module is the one place that question gets answered. Polite/impolite
 * role assignment (which feeds Perfect Negotiation) is centralised here
 * for the same reason.
 *
 * Side effects:
 *   - DM run: writes to `run.peer`
 *   - Group run: writes to `run.meshPeers.get(remoteAccount)`
 *   - Dispatches `peerOpened` / `peerLost` events into the per-run actor
 *     when the underlying WebRTC peer reports state changes.
 *
 * Returns the live peer (existing or freshly created).
 */
export function ensureConnection(
    host: ChatDataOrchestratorHost,
    run: SpaceRun,
    sessionId: string,
    self: string,
    remoteAccount: string,
): ChatDataWebRtcPeer | null {
    const signaling = host.getSignaling();
    if (!signaling) return null;

    const roster =
        run.sessionRoster.size > 0 ? run.sessionRoster : undefined;
    const isInitiator = shouldInitiateOffer(
        self,
        remoteAccount,
        roster,
    );

    const existing = getConnection(run, remoteAccount);
    if (
        existing &&
        existing.sessionId === sessionId &&
        !existing.isDisposed
    ) {
        if (existing.needsReconnect) {
            chatDataLog("ensureConnection: rebuild stale peer", {
                space: shortSpaceId(run.spaceUuid),
                sessionId: shortSessionId(sessionId),
                remote: remoteAccount,
            });
            existing.dispose();
        } else if (
            !existing.dataChannelReady &&
            existing.sendsInitialOffer !== isInitiator
        ) {
            // Group mesh: roster-derived initiator is authoritative until the
            // data channel opens. Reusing the wrong role leaves legs stuck in
            // half-open negotiation (mesh e2e step 18).
            if (run.kind === "group") {
                chatDataLog(
                    "ensureConnection: rebuild group mesh for initiator role",
                    {
                        space: shortSpaceId(run.spaceUuid),
                        sessionId: shortSessionId(sessionId),
                        remote: remoteAccount,
                        wasInitiator: existing.sendsInitialOffer,
                        isInitiator,
                    },
                );
                existing.dispose();
            } else {
                // DM locks polite/impolite at peer creation for this leg.
                // Roster snapshots can flip shouldInitiateOffer after an
                // answer is already in flight; rebuilding here caused
                // offer/answer glare when the remote rejoined (matrix e2e).
                chatDataLog(
                    "ensureConnection: DM initiator role drift ignored",
                    {
                        space: shortSpaceId(run.spaceUuid),
                        sessionId: shortSessionId(sessionId),
                        remote: remoteAccount,
                        wasInitiator: existing.sendsInitialOffer,
                        isInitiator,
                    },
                );
                return existing;
            }
        } else if (run.kind === "group" && !existing.dataChannelReady) {
            if (
                existing.negotiationInProgress &&
                existing.sendsInitialOffer
            ) {
                chatDataLog("ensureConnection: group mesh resend offer", {
                    space: shortSpaceId(run.spaceUuid),
                    sessionId: shortSessionId(sessionId),
                    remote: remoteAccount,
                });
                existing.resendOffer();
                return existing;
            }
            chatDataLog("ensureConnection: rebuild group mesh without dc", {
                space: shortSpaceId(run.spaceUuid),
                sessionId: shortSessionId(sessionId),
                remote: remoteAccount,
                polite: !existing.sendsInitialOffer,
            });
            existing.dispose();
        } else {
            chatDataLog("ensureConnection: reuse", {
                space: shortSpaceId(run.spaceUuid),
                sessionId: shortSessionId(sessionId),
                remote: remoteAccount,
                dataChannelReady: existing.dataChannelReady,
            });
            return existing;
        }
    } else {
        existing?.dispose();
    }

    // F2: roster-aware initiation. If the run has a server-authoritative
    // roster (because at least one sessionSnapshot has arrived), use the
    // joinedAt ordering — the late joiner sends the offer. If not, fall
    // back to lex order. The polite/impolite collision role lives inside
    // the WebRTC peer and is always lex, independent of this decision.
    chatDataLog("ensureConnection: create", {
        space: shortSpaceId(run.spaceUuid),
        sessionId: shortSessionId(sessionId),
        remote: remoteAccount,
        isInitiator,
        rosterSize: run.sessionRoster.size,
    });
    const peer = new ChatDataWebRtcPeer({
        sessionId,
        selfAccount: self,
        peerAccount: remoteAccount,
        iceServers: host.getIceServers(),
        signaling,
        isInitiator,
        // F2: keep polite/impolite on lex order independent of who
        // initiates so glare resolution stays symmetric regardless of
        // join order.
        impolite: isImpoliteForCollision(self, remoteAccount),
        handlers: {
            onDataChannelOpen: () => {
                host.dispatchRunEventForRun(run, {
                    type: "peerOpened",
                    remoteAccount,
                });
            },
            onChatMessage: (envelope) => {
                host.onChatMessage?.(run.spaceUuid, envelope);
                // Plan F7: send delivery acknowledgement back over the
                // same data channel so the sender can mark the message
                // as actually delivered. Done synchronously after the
                // local persist callback so the ack only fires if we
                // successfully ingested the message above.
                const me = host.getSelf();
                if (!me) return;
                const live = getConnection(run, envelope.from);
                if (!live || !live.dataChannelReady) return;
                live.sendMessageAck({
                    t: "messageAck",
                    spaceUuid: envelope.spaceUuid,
                    clientMsgId: envelope.clientMsgId,
                    from: me,
                });
            },
            onChatHistorySync: (envelope) => {
                host.onChatHistorySync?.(run.spaceUuid, envelope);
            },
            onMessageAck: (envelope) => {
                host.onMessageAck?.(run.spaceUuid, envelope);
            },
            onFailed: (detail) => {
                // DM: a peer-level failure kills the whole DM run (there
                // is only one peer). Group: it's a per-connection failure
                // that should leave the rest of the mesh intact.
                if (run.kind === "dm") {
                    host.dispatchRunEventForRun(run, {
                        type: "failed",
                        detail,
                    });
                } else {
                    host.dispatchRunEventForRun(run, {
                        type: "peerLost",
                        remoteAccount,
                        detail,
                    });
                }
            },
            onTransportLost: (detail) => {
                host.dispatchRunEventForRun(run, {
                    type: "peerLost",
                    remoteAccount,
                    detail,
                });
            },
        },
    });

    setConnection(run, remoteAccount, peer);
    return peer;
}

/**
 * Per-connection lookup. Hides the DM-vs-group storage difference.
 */
export function getConnection(
    run: SpaceRun,
    remoteAccount: string,
): ChatDataWebRtcPeer | null {
    if (run.kind === "dm") {
        return run.peerAccount === remoteAccount ? run.peer : null;
    }
    return run.meshPeers.get(remoteAccount) ?? null;
}

/**
 * Per-connection write. Hides the DM-vs-group storage difference.
 */
function setConnection(
    run: SpaceRun,
    remoteAccount: string,
    peer: ChatDataWebRtcPeer,
): void {
    if (run.kind === "dm") {
        if (run.peerAccount === remoteAccount) {
            run.peer = peer;
        }
        return;
    }
    run.meshPeers.set(remoteAccount, peer);
}

/**
 * Per-connection teardown. Hides the DM-vs-group storage difference.
 */
export function releaseConnection(
    host: ChatDataOrchestratorHost,
    run: SpaceRun,
    remoteAccount: string,
    reason: string,
): void {
    const existing = getConnection(run, remoteAccount);
    if (!existing) return;
    chatDataRecord("releaseConnection", {
        space: shortSpaceId(run.spaceUuid),
        remote: remoteAccount,
        reason,
    });
    existing.dispose();
    if (run.kind === "dm") {
        run.peer = null;
    } else {
        run.meshPeers.delete(remoteAccount);
    }
    host.syncRunSnapshot(run);
}

/**
 * Per-run teardown for every connection. Equivalent to calling
 * `releaseConnection` for every active remote, plus clearing
 * `hasJoined` is the caller's responsibility (the FSM owns that flag).
 */
export function releaseAllConnections(run: SpaceRun): void {
    if (run.kind === "dm") {
        run.peer?.dispose();
        run.peer = null;
        return;
    }
    for (const peer of run.meshPeers.values()) {
        peer.dispose();
    }
    run.meshPeers.clear();
}
