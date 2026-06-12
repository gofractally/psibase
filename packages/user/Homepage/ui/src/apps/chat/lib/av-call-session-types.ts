import type { MeetPeerHandle } from "./meet-peer-handle";
import type { IceServerConfig } from "./protocol";
import type { RealtimeClient } from "./realtime-client";
import type { WebRtcSignalingClient } from "./webrtc-signaling-client";
import type { PeerTransportRegistry } from "../transport/l3-peer-registry";

/** Transport-recovery tunables (A4). Mirror of chat-data values; can be
 * tuned independently if av-call needs different backoff. */
export const AV_MAX_TRANSPORT_RECOVERY_ATTEMPTS = 6;
export const AV_TRANSPORT_RECOVERY_BASE_MS = 2_000;
export const AV_TRANSPORT_RECOVERY_MAX_MS = 30_000;

/** User-visible copy for ICE / WebRTC connectivity failures (Meet av-call). */
export function avCallConnectivityErrorMessage(detail: string): string {
    if (/ice connection|webrtc connection|connectivity|ice-failed/i.test(detail)) {
        return (
            "Could not establish a media connection. The node may have no TURN relay quota left, " +
            "or this network blocks direct and relay paths. Try another network or ask a node admin " +
            "to check Chat and OpenRelay settings in x-admin."
        );
    }
    return detail;
}

export type AvCallSessionPhase =
    | "idle"
    | "ensuring"
    | "creating"
    | "joining"
    | "waiting-peer"
    | "signaling"
    | "ready"
    | "failed";

export type AvCallSessionSnapshot = {
    spaceUuid: string;
    phase: AvCallSessionPhase;
    sessionId?: string;
    /** True once joinSession completed for the current attempt. */
    signalingJoined: boolean;
    /** True once DM peer connection carries media (T-034). */
    mediaConnected?: boolean;
    /** Group mesh: per-remote-member media connected (T-035). */
    meshPeerSignalingReady?: Record<string, boolean>;
    lastError?: string;
};

export type AvCallIncomingInvite = {
    sessionId: string;
    spaceUuid: string;
    from: string;
    wantVideo: boolean;
    wantAudio: boolean;
    /** N-party participant set from sessionInvite (architecture §6.2). */
    participants?: readonly string[];
};

export type AvCallSpaceRunBase = {
    spaceUuid: string;
    members: string[];
    abort: AbortController;
    snapshot: AvCallSessionSnapshot;
    hasJoined: boolean;
    onUpdate: () => void;
    /** Capped exponential-backoff attempt counter for transport recovery (A4). */
    transportRecoveryAttempt: number;
    /** Set synchronously on sessionInvite until callee accepts/declines. */
    awaitingInviteAccept?: boolean;
};

export type DmAvCallRun = AvCallSpaceRunBase & {
    kind: "dm";
    peerAccount: string;
    wantVideo: boolean;
    wantAudio: boolean;
    peer: MeetPeerHandle | null;
};

export type GroupAvCallRun = AvCallSpaceRunBase & {
    kind: "group";
    /** One WebRTC A/V peer connection per online remote member (§5.3 mesh). */
    meshPeers: Map<string, MeetPeerHandle>;
    wantVideo: boolean;
    wantAudio: boolean;
    /** Shared camera/mic stream across all mesh peer connections. */
    localStream: MediaStream | null;
    peerOnlineAtSessionStart: Map<string, boolean>;
};

export type AvCallSpaceRun = DmAvCallRun | GroupAvCallRun;

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

/** Lower account creates the SDP offer (glare-safe when both sides orchestrate). */
export function shouldInitiateOffer(self: string, peer: string): boolean {
    return self.localeCompare(peer) < 0;
}

export interface AvCallOrchestratorHost {
    getRealtime(): RealtimeClient | null;
    getSelf(): string | null;
    getIceServers(): IceServerConfig[] | null;
    getPeerPresence(): Record<string, string>;
    getSignaling(): WebRtcSignalingClient | null;
    setSignaling(signaling: WebRtcSignalingClient): void;

    /** Per-peer transport: one pair PC per remote for chat + Meet. */
    getSharedPeerRegistry?(): PeerTransportRegistry | null;
    usesSharedTransport?(): boolean;

    getRun(spaceUuid: string): AvCallSpaceRun | undefined;
    setRun(spaceUuid: string, run: AvCallSpaceRun): void;
    deleteRun(spaceUuid: string): void;
    getRuns(): IterableIterator<AvCallSpaceRun>;
    findRunBySessionId(sessionId: string): AvCallSpaceRun | undefined;

    liveSnapshot(run: AvCallSpaceRun): AvCallSessionSnapshot;
    meshPeerSignalingReadyMap(run: GroupAvCallRun): Record<string, boolean>;
    anyMeshMediaReady(run: GroupAvCallRun): boolean;

    setPhase(
        run: AvCallSpaceRun,
        phase: AvCallSessionPhase,
        extra?: Partial<AvCallSessionSnapshot>,
    ): void;
    fail(run: AvCallSpaceRun, detail: string): void;
    tearDownSignaling(run: AvCallSpaceRun, reason: string): void;
    tearDownMeshSignalingPeer(
        run: GroupAvCallRun,
        remoteAccount: string,
        reason: string,
    ): void;
    beginSignaling(run: AvCallSpaceRun, sessionId: string): Promise<void>;
    runPipeline(run: AvCallSpaceRun): Promise<void>;
    recoverStaleAvCallSession?(
        run: AvCallSpaceRun,
        staleSessionId: string,
    ): Promise<void>;
    recordAvCallSessionSnapshot?(
        sessionId: string,
        joinedParticipants: string[],
        pendingParticipants: string[],
    ): void;
    removeParticipantFromAvCallSessionRoster?(
        sessionId: string,
        participant: string,
    ): void;
    retireAvCallSession?(sessionId: string): void;
    unretireAvCallSession?(sessionId: string): void;
    /** True when the callee has an incoming ring and has not accepted yet. */
    isAvCallPendingInvite?(spaceUuid: string): boolean;
    isRetiredAvCallSession?(sessionId: string): boolean;
    tearDownDmPeer(run: DmAvCallRun, reason: string): void;

    onPeerOnline(peerAccount: string): void;
    onPeerOffline(peerAccount: string): void;

    /** Transport-recovery hooks (A4). Optional only because the
     * orchestrator class has them and tests/fakes may stub them. */
    scheduleTransportRecovery?(run: AvCallSpaceRun): void;
    cancelTransportRecovery?(run: AvCallSpaceRun): void;
    /** Actor-event dispatch (A3 foundation; recovery uses this for ticks). */
    dispatchRunEventForRun?(
        run: AvCallSpaceRun,
        event: import("./av-call-run-state-machine").AvRunEvent,
    ): void;
    dispatchRunEventAndWait?(
        run: AvCallSpaceRun,
        event: import("./av-call-run-state-machine").AvRunEvent,
    ): Promise<void>;

    setPendingInvite(invite: AvCallIncomingInvite): void;
    clearPendingInvite?(sessionId: string): void;
    onInviteCleared?(sessionId: string): void;
    onSpaceUpdate?(spaceUuid: string, snap: AvCallSessionSnapshot): void;
    onAvCallMediaReady?(
        spaceUuid: string,
        info: {
            peerAccount: string;
            localStream: MediaStream;
            remoteStream: MediaStream | null;
        },
    ): void;
    onParticipantState?(
        sessionId: string,
        participant: string,
        state: {
            audioMuted?: boolean;
            videoMuted?: boolean;
        },
    ): void;
}
