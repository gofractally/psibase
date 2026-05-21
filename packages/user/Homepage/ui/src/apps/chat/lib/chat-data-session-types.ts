import type { ChatDataWebRtcPeer } from "./chat-data-webrtc-peer";
import type {
    ChatDataMessageEnvelope,
    ChatHistorySyncEnvelope,
} from "./chat-data-envelope";
import type { IceServerConfig } from "./protocol";
import type { RealtimeClient } from "./realtime-client";
import type { WebRtcSignalingClient } from "./webrtc-signaling-client";

export type ChatDataSessionPhase =
    | "idle"
    | "ensuring"
    | "creating"
    | "joining"
    | "waiting-peer"
    | "signaling"
    | "ready"
    | "failed";

export type ChatDataSessionSnapshot = {
    spaceUuid: string;
    phase: ChatDataSessionPhase;
    sessionId?: string;
    /** DM: single peer ready; group: any mesh peer ready. */
    dataChannelReady: boolean;
    /** Group mesh: per-remote-member data channel readiness. */
    meshPeerReady?: Record<string, boolean>;
    lastError?: string;
};

/**
 * F1: server-authoritative roster entry. The signaling server emits a
 * `sessionSnapshot` after every join / dead-socket teardown; the client
 * fills this map with the join order so the initiator role (F2) can be
 * decided by who arrived later rather than by lex ordering. `joinedAt`
 * is the client's local monotonic timestamp at the moment the participant
 * first appeared in a snapshot — server clocks would be ideal but client
 * order is good enough because the server fans out snapshots in
 * causal order over the same WS.
 */
export type SessionRosterEntry = {
    account: string;
    joinedAt: number;
};

export type SpaceRunBase = {
    spaceUuid: string;
    members: string[];
    abort: AbortController;
    snapshot: ChatDataSessionSnapshot;
    /**
     * True after the server roster includes self in `joinedParticipants`
     * (not merely after `joinSession` was sent).
     */
    hasJoined: boolean;
    /** True after `joinSession` was sent for the current welcome generation. */
    joinSessionRequested: boolean;
    /**
     * Server `welcome` generation when we last sent `joinSession`. After a
     * websocket reconnect the subjective join row is tied to the old socket;
     * if this differs from the live client's generation, `hasJoined` is stale.
     */
    joinedWelcomeGeneration: number;
    transportRecoveryAttempt: number;
    onUpdate: () => void;
    /**
     * F1: server-authoritative session roster. Updated on every
     * `sessionSnapshot` frame. Empty when no snapshot has arrived yet
     * (pre-join or no-roster server). Keyed by account.
     */
    sessionRoster: Map<string, SessionRosterEntry>;
    /** Last applied `sessionSnapshot.epoch` (ignore stale/out-of-order frames). */
    sessionSnapshotEpoch: number;
    /**
     * Accounts that recently received `transportLost` — used to accept a
     * lower-epoch `sessionSnapshot` that moves them to `pendingParticipants`.
     */
    transportLostAt: Map<string, number>;
    /** Throttle `ensure` nudges from pending-flush while waiting on mesh. */
    lastMeshNudgeMs: number;
};

export type DmSpaceRun = SpaceRunBase & {
    kind: "dm";
    peerAccount: string;
    peerWasOnlineAtSessionStart: boolean;
    peer: ChatDataWebRtcPeer | null;
};

export type GroupSpaceRun = SpaceRunBase & {
    kind: "group";
    meshPeers: Map<string, ChatDataWebRtcPeer>;
    peerOnlineAtSessionStart: Map<string, boolean>;
    /** True once a mesh data channel to the remote has opened in this run. */
    peerHadOpenDataChannel: Map<string, boolean>;
};

export type SpaceRun = DmSpaceRun | GroupSpaceRun;

export const MAX_TRANSPORT_RECOVERY_ATTEMPTS = 6;
export const TRANSPORT_RECOVERY_BASE_MS = 2_000;
export const TRANSPORT_RECOVERY_MAX_MS = 30_000;
/**
 * Plan F7: a shorter starting backoff for the "presence stays online"
 * recovery path. When the remote is still presence-online (i.e. their
 * websocket survived) but a particular data channel died, the most
 * likely failure modes are an SCTP/DTLS hiccup or an ICE rebinding —
 * both of which converge fast on a fresh peer. Using the 2s baseline
 * here meant typical recoveries felt sluggish; 500ms-then-exponential
 * gets the data channel back in ~600ms in the happy case while still
 * backing off cleanly on persistent failures.
 */
export const TRANSPORT_RECOVERY_PRESENCE_ONLINE_BASE_MS = 500;

export function dmPeerAccount(
    members: readonly string[],
    self: string,
): string | null {
    const others = members.filter((m) => m !== self);
    return others.length === 1 ? others[0]! : null;
}

export function isGroupMembers(members: readonly string[]): boolean {
    return members.length > 2;
}

export function remoteMembers(
    members: readonly string[],
    self: string,
): string[] {
    return members.filter((m) => m !== self);
}

/**
 * F2: who sends the first offer when a peer arrives.
 *
 * Strategy: **the most recent joiner sends the offer**. The intuition is
 * that if I am already in the session (peer arrived after me), the peer
 * has nothing to send me yet — it has to ask. The newcomer is the one
 * with the asymmetric knowledge ("I just arrived, please connect me").
 *
 * This replaces the old lexicographic rule which made the session creator
 * *passive*: when alice creates a session and bob/carol join later, lex
 * order said alice initiates, but at create-time alice has no peers to
 * offer to, and once bob joins alice silently doesn't re-offer. The
 * newcomer (bob) is the only one in a good position to drive the
 * handshake.
 *
 * Falls back to lex order when the roster is incomplete (e.g. snapshot
 * hasn't arrived yet), preserving the legacy semantics so the polite/
 * impolite collision-resolution role used by Perfect Negotiation
 * (`ChatDataWebRtcPeer.impolite`) remains stable.
 */
export function shouldInitiateOffer(
    self: string,
    peer: string,
    roster?: ReadonlyMap<string, SessionRosterEntry>,
): boolean {
    if (roster) {
        const selfEntry = roster.get(self);
        const peerEntry = roster.get(peer);
        if (selfEntry && peerEntry) {
            // Strict inequality: I joined later than peer ⇒ I initiate.
            if (selfEntry.joinedAt !== peerEntry.joinedAt) {
                return selfEntry.joinedAt > peerEntry.joinedAt;
            }
            // Same joinedAt is a tie (should be rare given monotonic local
            // time). Break ties deterministically by lex so both sides
            // agree on who initiates.
            return self.localeCompare(peer) < 0;
        }
        // If only one side has a roster entry, that side initiates (it knows
        // it's the newcomer; the other side will see it via snapshot soon).
        if (selfEntry && !peerEntry) return true;
        if (!selfEntry && peerEntry) return false;
    }
    // No roster information available — fall back to lex order to preserve
    // existing behavior and keep the polite/impolite role stable.
    return self.localeCompare(peer) < 0;
}

/**
 * F2: polite/impolite role for Perfect Negotiation collision resolution.
 * This MUST be deterministic and symmetric regardless of arrival order, so
 * it stays on the lex rule independent of the initiator rule above. The
 * impolite peer (lex-lower) wins glare; the polite peer rolls back.
 */
export function isImpoliteForCollision(self: string, peer: string): boolean {
    return self.localeCompare(peer) < 0;
}

/** Host surface exposed to chat-data session submodules. */
export interface ChatDataOrchestratorHost {
    getRealtime(): RealtimeClient | null;
    getSelf(): string | null;
    getIceServers(): IceServerConfig[] | null;
    getPeerPresence(): Record<string, string>;
    getSignaling(): WebRtcSignalingClient | null;
    setSignaling(signaling: WebRtcSignalingClient): void;

    getRun(spaceUuid: string): SpaceRun | undefined;
    setRun(spaceUuid: string, run: SpaceRun): void;
    deleteRun(spaceUuid: string): void;
    getRuns(): IterableIterator<SpaceRun>;
    findRunBySessionId(sessionId: string): SpaceRun | undefined;

    liveSnapshot(run: SpaceRun): ChatDataSessionSnapshot;
    anyMeshDataChannelReady(run: GroupSpaceRun): boolean;

    /** Serialized per-run event dispatch (Phase 2 actor mailbox). */
    dispatchRunEventForRun(run: SpaceRun, event: import("./chat-data-run-state-machine").RunEvent): void;
    dispatchRunEventAndWait(
        run: SpaceRun,
        event: import("./chat-data-run-state-machine").RunEvent,
    ): Promise<void>;
    syncRunSnapshot(run: SpaceRun): void;

    fail(run: SpaceRun, detail: string): void;
    tearDownTransport(run: SpaceRun, reason: string): void;
    tearDownMeshPeer(
        run: GroupSpaceRun,
        remoteAccount: string,
        reason: string,
    ): void;
    beginSignaling(run: SpaceRun, sessionId: string): Promise<void>;
    runPipeline(run: SpaceRun): Promise<void>;

    cancelTransportRecovery(run: SpaceRun): void;
    scheduleTransportRecovery(run: SpaceRun): void;

    onPeerOnline(peerAccount: string): void;

    ensureGroupChatDataSession(
        spaceUuid: string,
        members: readonly string[],
    ): void;

    /**
     * Unified entry point: callers no longer need to switch on member count.
     * Routes to DM/group ensure helpers internally and dispatches an `ensure`
     * event into the per-run actor for any existing run.
     */
    ensureChatDataSession(
        spaceUuid: string,
        members: readonly string[],
    ): void;

    onSpaceUpdate?(spaceUuid: string, snap: ChatDataSessionSnapshot): void;
    onChatMessage?(
        spaceUuid: string,
        envelope: ChatDataMessageEnvelope,
    ): void;
    onChatHistorySync?(
        spaceUuid: string,
        envelope: ChatHistorySyncEnvelope,
    ): void;
    /**
     * Plan F7: receiver→sender delivery acknowledgement. Fires when the
     * peer receives an app-level `messageAck` over the data channel.
     * `envelope.from` is the recipient confirming receipt;
     * `envelope.clientMsgId` matches the original outbound message id.
     */
    onMessageAck?(
        spaceUuid: string,
        envelope: import("./chat-data-envelope").ChatDataMessageAckEnvelope,
    ): void;
    onDataChannelReady?(
        spaceUuid: string,
        info: { peerAccount: string; shouldPushHistory: boolean },
    ): void;
    /** Fired when a chat-data sessionInvite arrives (e.g. reload objective spaces). */
    onChatDataSessionInvite?(spaceUuid: string): void;
    /**
     * Plan C3: SM-driven targeted flush. The state machine emits this when a
     * remote DC opens so the outbox can flush only messages destined for the
     * specific recipient(s), not blanket-flush every conversation.
     */
    onFlushPendingRecipients?(
        spaceUuid: string,
        recipients: readonly string[],
    ): void;
}
