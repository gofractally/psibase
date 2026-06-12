import type { ChatObjectiveCallEvent } from "./call-timeline-bridge";
import {
    createAvCallSession,
    fetchActiveAvCallSession,
    waitForActiveAvCallSession,
    type ChatSessionEntry,
} from "./chat-api";
import {
    buildGroupAvCallInviteFromActiveSession,
    inferGroupCallInviter,
    shouldDiscoverActiveGroupAvCall,
} from "./group-contacts-meet-flow";
import {
    avCallLog,
    avCallRecord,
    shortSessionId,
    shortSpaceId,
} from "./av-call-debug";
import {
    commitAvCallParticipantLeft,
    commitAvCallTimelineEvent,
} from "./av-call-timeline-commit";
import {
    beginSignalingDmAvCall,
    beginSignalingDmAvCallSkipChecks,
    ensureDmAvCallSession,
    tearDownDmAvCallPeer,
} from "./av-call-dm-orchestrator";
import {
    beginSignalingGroupAvCall,
    beginSignalingGroupAvCallSkipChecks,
    ensureGroupAvCallSession,
    reconcileGroupMeshMediaConnected,
    tearDownGroupLocalMedia,
    tearDownMeshSignalingPeer,
} from "./av-call-group-orchestrator";
import { wireAvCallRealtimeHandlers } from "./av-call-realtime-handlers";
import {
    AvCallRunCommandExecutor,
    AvRunActor,
    createAvRunActor,
} from "./av-call-run-actor";
import type { AvRunEvent } from "./av-call-run-state-machine";
import { AvCallTransportRecoveryManager } from "./av-call-transport-recovery";
import {
    dmPeerAccount,
    isGroupMembers,
    remoteMembers,
    shouldInitiateOffer,
    type AvCallIncomingInvite,
    type AvCallOrchestratorHost,
    type AvCallSessionPhase,
    type AvCallSessionSnapshot,
    type AvCallSpaceRun,
    type DmAvCallRun,
    type GroupAvCallRun,
} from "./av-call-session-types";
import type { IceServerConfig } from "./protocol";
import type { RealtimeClient } from "./realtime-client";
import type { WebRtcSignalingClient } from "./webrtc-signaling-client";
import type { PeerTransportRegistry } from "../transport/l3-peer-registry";

export type {
    AvCallIncomingInvite,
    AvCallSessionPhase,
    AvCallSessionSnapshot,
    DmAvCallRun,
    GroupAvCallRun,
} from "./av-call-session-types";

/**
 * Lazy per-space background orchestration: objective createSession(av-call)
 * then x-webrtcsig joinSession + signaling (architecture §7).
 * DM: one peer; group: mesh A/V peer connections per online member (§5.3).
 */
export class AvCallSessionOrchestrator implements AvCallOrchestratorHost {
    private readonly runs = new Map<string, AvCallSpaceRun>();

    private readonly actors = new Map<string, AvRunActor>();

    private readonly runExecutor = new AvCallRunCommandExecutor(this);

    private signaling: WebRtcSignalingClient | null = null;

    private realtimeHandlersInstalled = false;

    private readonly transportRecovery = new AvCallTransportRecoveryManager();

    private reconcileAfterReconnectTimer: ReturnType<
        typeof globalThis.setTimeout
    > | null = null;

    private pendingInvite: AvCallIncomingInvite | null = null;

    /** Objective/signaling sessions the user explicitly left; ignore WS resurrection. */
    private readonly retiredAvCallSessionIds = new Set<string>();

    /** Latest x-webrtcsig roster per objective av-call session (not pair sessions). */
    private readonly avCallSessionRosters = new Map<
        string,
        { joined: string[]; pending: string[] }
    >();

    constructor(
        private readonly getRealtimeFn: () => RealtimeClient | null,
        private readonly getSelfFn: () => string | null,
        private readonly getIceServersFn: () => IceServerConfig[] | null,
        private readonly getPeerPresenceFn: () => Record<string, string>,
        private readonly onIncomingInviteCb?: (
            invite: AvCallIncomingInvite,
        ) => void,
        readonly onInviteCleared?: (sessionId: string) => void,
        readonly onSpaceUpdate?: (
            spaceUuid: string,
            snap: AvCallSessionSnapshot,
        ) => void,
        readonly onAvCallMediaReady?: (
            spaceUuid: string,
            info: {
                peerAccount: string;
                localStream: MediaStream;
                remoteStream: MediaStream | null;
            },
        ) => void,
        readonly onParticipantState?: (
            sessionId: string,
            participant: string,
            state: {
                audioMuted?: boolean;
                videoMuted?: boolean;
            },
        ) => void,
        private readonly getSharedPeerRegistryFn?: () => PeerTransportRegistry | null,
        private readonly getSharedSignalingFn?: () => WebRtcSignalingClient | null,
    ) {}

    start(): void {
        this.wireRealtime();
    }

    getSnapshot(spaceUuid: string): AvCallSessionSnapshot {
        const run = this.runs.get(spaceUuid);
        if (!run) {
            return {
                spaceUuid,
                phase: "idle",
                signalingJoined: false,
            };
        }
        const actorSnap = this.liveSnapshot(run);
        if (actorSnap.phase === "idle" && run.snapshot.phase !== "idle") {
            if (run.kind === "group") {
                return {
                    ...run.snapshot,
                    meshPeerSignalingReady: this.meshPeerSignalingReadyMap(run),
                };
            }
            return run.snapshot;
        }
        return actorSnap;
    }

    getOrCreateActor(run: AvCallSpaceRun): AvRunActor {
        let actor = this.actors.get(run.spaceUuid);
        if (!actor) {
            actor = createAvRunActor(run, this, this.runExecutor);
            this.actors.set(run.spaceUuid, actor);
        }
        return actor;
    }

    isAvCallPendingInvite(spaceUuid: string): boolean {
        const run = this.getRun(spaceUuid);
        if (run?.awaitingInviteAccept) return true;
        return this.actors.get(spaceUuid)?.machineState.tag === "pendingInvite";
    }

    dispatchRunEventForRun(run: AvCallSpaceRun, event: AvRunEvent): void {
        this.getOrCreateActor(run).dispatch(event);
    }

    async dispatchRunEventAndWait(
        run: AvCallSpaceRun,
        event: AvRunEvent,
    ): Promise<void> {
        await this.getOrCreateActor(run).dispatchAndWait(event);
    }

    syncRunSnapshot(run: AvCallSpaceRun): void {
        this.getOrCreateActor(run).syncSnapshot();
    }

    cancelTransportRecovery(run: AvCallSpaceRun): void {
        this.transportRecovery.cancelTransportRecovery(run);
    }

    scheduleTransportRecovery(run: AvCallSpaceRun): void {
        this.transportRecovery.scheduleTransportRecovery(run, this);
    }

    /**
     * Re-establish AV-call signaling state after the underlying realtime
     * websocket reconnected. Mirrors `ChatDataSessionOrchestrator.reconcileAfterReconnect`.
     * Called from the use-chat-socket reconnect-welcome handler.
     */
    reconcileAfterReconnect(): void {
        if (this.reconcileAfterReconnectTimer != null) {
            globalThis.clearTimeout(this.reconcileAfterReconnectTimer);
        }
        this.reconcileAfterReconnectTimer = globalThis.setTimeout(() => {
            this.reconcileAfterReconnectTimer = null;
            this.reconcileAfterReconnectNow();
        }, 50);
    }

    private reconcileAfterReconnectNow(): void {
        const rt = this.getRealtime();
        if (!rt?.isSessionReady) return;
        const self = this.getSelf();

        avCallLog("av-call reconcileAfterReconnect", {
            runCount: this.runs.size,
        });

        for (const run of this.runs.values()) {
            const sessionId = run.snapshot.sessionId;
            const phase = run.snapshot.phase;

            if (
                phase === "ensuring" ||
                phase === "creating" ||
                phase === "failed" ||
                !sessionId
            ) {
                continue;
            }

            // Drop transport-level state but keep the SM in a recoverable
            // state. Mirror chat-data: dispatch transportTornDown, then
            // either re-begin or defer based on presence.
            this.dispatchRunEventForRun(run, {
                type: "transportTornDown",
                reason: "realtime reconnect",
                sessionId,
            });

            const anyOnline =
                !!self &&
                (run.kind === "group"
                    ? remoteMembers(run.members, self).some(
                          (m) => this.getPeerPresence()[m] === "online",
                      )
                    : this.getPeerPresence()[run.peerAccount] === "online");

            if (anyOnline) {
                this.dispatchRunEventForRun(run, {
                    type: "beginSignaling",
                    sessionId,
                });
            } else {
                this.dispatchRunEventForRun(run, {
                    type: "signalingDeferred",
                    sessionId,
                });
            }
        }
    }

    ensureDmAvCallSession(
        spaceUuid: string,
        members: readonly string[],
    ): void {
        ensureDmAvCallSession(this, spaceUuid, members);
    }

    ensureGroupAvCallSession(
        spaceUuid: string,
        members: readonly string[],
    ): void {
        ensureGroupAvCallSession(this, spaceUuid, members);
    }

    acceptIncomingInvite(): void {
        const invite = this.pendingInvite;
        if (!invite) return;
        const self = this.getSelf();
        if (!self) return;

        const run = this.ensureRunForInvite(invite, self);
        void (async () => {
            await this.ensurePendingInviteOnActor(run, invite);
            run.awaitingInviteAccept = false;
            await this.dispatchRunEventAndWait(run, { type: "acceptInvite" });
            if (run.kind === "group") {
                reconcileGroupMeshMediaConnected(this, run);
            }
        })();
    }

    declineIncomingInvite(reason: "user" | "timeout"): void {
        const invite = this.pendingInvite;
        if (!invite) return;

        const run = this.getRun(invite.spaceUuid);
        if (!run) {
            this.clearPendingInvite(invite.sessionId);
            return;
        }

        void (async () => {
            await this.ensurePendingInviteOnActor(run, invite);
            await this.dispatchRunEventAndWait(run, {
                type: "declineInvite",
                reason,
            });
            run.awaitingInviteAccept = false;
            this.deleteRun(run.spaceUuid);
        })();
    }

    /** User hangup / cancel from Meet UI — routed through meetCall FSM. */
    hangupAvCallSession(spaceUuid: string, reason = "ended"): void {
        const run = this.getRun(spaceUuid);
        if (!run) return;
        const sessionId = run.snapshot.sessionId;
        const self = this.getSelf();
        void this.dispatchRunEventAndWait(run, { type: "hangup", reason }).then(
            () => {
                if (sessionId && self) {
                    this.removeParticipantFromAvCallSessionRoster(
                        sessionId,
                        self,
                    );
                }
                if (sessionId && run.kind === "dm") {
                    this.retireAvCallSession(sessionId);
                    this.avCallSessionRosters.delete(sessionId);
                }
                this.deleteRun(spaceUuid);
            },
        );
    }

    getPendingInvite(): AvCallIncomingInvite | null {
        return this.pendingInvite;
    }

    setPendingInvite(invite: AvCallIncomingInvite): void {
        this.pendingInvite = invite;
        this.onIncomingInviteCb?.(invite);
    }

    clearPendingInvite(sessionId: string): void {
        if (this.pendingInvite?.sessionId === sessionId) {
            this.pendingInvite = null;
        }
        this.onInviteCleared?.(sessionId);
    }

    private ensureRunForInvite(
        invite: AvCallIncomingInvite,
        self: string,
    ): AvCallSpaceRun {
        let run = this.getRun(invite.spaceUuid);
        if (run) return run;

        const abort = new AbortController();
        const members = invite.participants ?? [self, invite.from];
        const isGroup = isGroupMembers(members);

        if (isGroup) {
            const groupRun: GroupAvCallRun = {
                kind: "group",
                spaceUuid: invite.spaceUuid,
                members: [...members],
                meshPeers: new Map(),
                wantVideo: invite.wantVideo,
                wantAudio: invite.wantAudio,
                localStream: null,
                peerOnlineAtSessionStart: new Map(),
                abort,
                snapshot: {
                    spaceUuid: invite.spaceUuid,
                    phase: "waiting-peer",
                    sessionId: invite.sessionId,
                    signalingJoined: false,
                    meshPeerSignalingReady: {},
                },
                hasJoined: false,
                transportRecoveryAttempt: 0,
                onUpdate: () => {
                    this.onSpaceUpdate?.(
                        invite.spaceUuid,
                        this.liveSnapshot(groupRun),
                    );
                },
            };
            this.setRun(invite.spaceUuid, groupRun);
            return groupRun;
        }

        const dmPeer = dmPeerAccount(members, self) ?? invite.from;
        const dmRun: DmAvCallRun = {
            kind: "dm",
            spaceUuid: invite.spaceUuid,
            members: [...members],
            peerAccount: dmPeer,
            wantVideo: invite.wantVideo,
            wantAudio: invite.wantAudio,
            peer: null,
            abort,
            snapshot: {
                spaceUuid: invite.spaceUuid,
                phase: "waiting-peer",
                sessionId: invite.sessionId,
                signalingJoined: false,
                mediaConnected: false,
            },
            hasJoined: false,
            transportRecoveryAttempt: 0,
            onUpdate: () => {
                this.onSpaceUpdate?.(
                    invite.spaceUuid,
                    this.liveSnapshot(dmRun),
                );
            },
        };
        this.setRun(invite.spaceUuid, dmRun);
        return dmRun;
    }

    private async ensurePendingInviteOnActor(
        run: AvCallSpaceRun,
        invite: AvCallIncomingInvite,
    ): Promise<void> {
        const actor = this.actors.get(run.spaceUuid);
        if (actor?.machineState.tag === "pendingInvite") {
            return;
        }
        await this.dispatchRunEventAndWait(run, {
            type: "sessionInvite",
            sessionId: invite.sessionId,
            from: invite.from,
            wantVideo: invite.wantVideo,
            wantAudio: invite.wantAudio,
        });
    }

    /**
     * Surface a pending group Meet invite when an active av-call exists but the
     * user missed the websocket sessionInvite while offline (M5 partial join).
     */
    async discoverActiveGroupAvCallInvite(
        spaceUuid: string,
        members: readonly string[],
        callEvents: readonly ChatObjectiveCallEvent[],
        options: {
            activeCallConversationId?: string;
            contactsLoaded: boolean;
            contactAccounts: ReadonlySet<string>;
        },
    ): Promise<boolean> {
        const self = this.getSelf();
        if (!self || !isGroupMembers(members)) return false;

        if (
            !shouldDiscoverActiveGroupAvCall(spaceUuid, self, members, {
                activeCallConversationId: options.activeCallConversationId,
                pendingInviteSpaceUuid: this.pendingInvite?.spaceUuid,
                hasLocalRun: !!this.getRun(spaceUuid),
                contactsLoaded: options.contactsLoaded,
                contactAccounts: options.contactAccounts,
            })
        ) {
            return false;
        }

        const session = await fetchActiveAvCallSession(spaceUuid);
        if (!session || session.lifecycle !== 1) return false;
        if (!session.participants.includes(self)) return false;

        const fallback =
            session.participants.find((member) => member !== self) ?? self;
        const inviter = inferGroupCallInviter(
            callEvents,
            session.session_id,
            fallback,
        );
        const invite = buildGroupAvCallInviteFromActiveSession(session, inviter);
        avCallLog("discoverActiveGroupAvCallInvite", {
            space: shortSpaceId(spaceUuid),
            sessionId: shortSessionId(invite.sessionId),
            from: inviter,
        });
        this.setPendingInvite(invite);
        return true;
    }

    onPeerOnline(peerAccount: string): void {
        if (this.getPeerPresence()[peerAccount] !== "online") {
            return;
        }
        const self = this.getSelf();
        for (const run of this.runs.values()) {
            if (!run.members.includes(peerAccount)) continue;
            if (run.kind === "group" && self && peerAccount === self) continue;
            if (run.kind === "dm" && run.peerAccount !== peerAccount) continue;

            avCallLog("onPeerOnline dispatch", {
                space: shortSpaceId(run.spaceUuid),
                peer: peerAccount,
                phase: run.snapshot.phase,
            });
            this.dispatchRunEventForRun(run, {
                type: "presenceOnline",
                account: peerAccount,
            });
        }
    }

    onPeerOffline(peerAccount: string): void {
        for (const run of this.runs.values()) {
            if (run.kind === "group") {
                if (!run.members.includes(peerAccount)) continue;
            } else if (run.peerAccount !== peerAccount) {
                continue;
            }

            avCallLog("onPeerOffline dispatch", {
                space: shortSpaceId(run.spaceUuid),
                peer: peerAccount,
                phase: run.snapshot.phase,
            });
            this.dispatchRunEventForRun(run, {
                type: "presenceOffline",
                account: peerAccount,
            });
        }
    }

    /** Drop local orchestration state after terminal UI dismisses. */
    clearRun(spaceUuid: string): void {
        this.deleteRun(spaceUuid);
    }

    dispose(): void {
        const signaling = this.signaling;
        for (const run of this.runs.values()) {
            run.abort.abort();
            if (run.kind === "dm") {
                this.tearDownDmPeer(run, "client-disposed");
            }
            if (signaling && run.hasJoined && run.snapshot.sessionId) {
                signaling.leaveSession(
                    run.snapshot.sessionId,
                    "client-disposed",
                );
            }
            if (run.kind === "group") {
                for (const peer of run.meshPeers.values()) {
                    peer.dispose();
                }
                run.meshPeers.clear();
                if (run.localStream) {
                    for (const t of run.localStream.getTracks()) {
                        t.stop();
                    }
                    run.localStream = null;
                }
            }
        }
        this.runs.clear();
        this.actors.clear();
        this.avCallSessionRosters.clear();
        this.realtimeHandlersInstalled = false;
        this.transportRecovery.dispose();
        if (this.reconcileAfterReconnectTimer != null) {
            globalThis.clearTimeout(this.reconcileAfterReconnectTimer);
            this.reconcileAfterReconnectTimer = null;
        }
        this.pendingInvite = null;
        this.signaling = null;
    }

    getRealtime(): RealtimeClient | null {
        return this.getRealtimeFn();
    }

    getSelf(): string | null {
        return this.getSelfFn();
    }

    getIceServers(): IceServerConfig[] | null {
        return this.getIceServersFn();
    }

    getPeerPresence(): Record<string, string> {
        return this.getPeerPresenceFn();
    }

    getSharedPeerRegistry(): PeerTransportRegistry | null {
        return this.getSharedPeerRegistryFn?.() ?? null;
    }

    usesSharedTransport(): boolean {
        return !!this.getSharedPeerRegistryFn?.();
    }

    getSignaling(): WebRtcSignalingClient | null {
        return this.signaling;
    }

    setSignaling(signaling: WebRtcSignalingClient): void {
        this.signaling = signaling;
    }

    getRun(spaceUuid: string): AvCallSpaceRun | undefined {
        return this.runs.get(spaceUuid);
    }

    setRun(spaceUuid: string, run: AvCallSpaceRun): void {
        this.runs.set(spaceUuid, run);
        this.getOrCreateActor(run);
    }

    deleteRun(spaceUuid: string): void {
        this.runs.delete(spaceUuid);
        this.actors.delete(spaceUuid);
    }

    getRuns(): IterableIterator<AvCallSpaceRun> {
        return this.runs.values();
    }

    findRunBySessionId(sessionId: string): AvCallSpaceRun | undefined {
        for (const run of this.runs.values()) {
            if (run.snapshot.sessionId === sessionId) return run;
        }
        return undefined;
    }

    meshPeerSignalingReadyMap(run: GroupAvCallRun): Record<string, boolean> {
        const out: Record<string, boolean> = {};
        for (const [remote, peer] of run.meshPeers) {
            out[remote] = peer.isMediaConnected;
        }
        return out;
    }

    anyMeshMediaReady(run: GroupAvCallRun): boolean {
        return Object.values(this.meshPeerSignalingReadyMap(run)).some(Boolean);
    }

    liveSnapshot(run: AvCallSpaceRun): AvCallSessionSnapshot {
        const actor = this.actors.get(run.spaceUuid);
        if (actor) {
            return actor.getSnapshot();
        }
        if (run.kind === "dm") {
            return run.snapshot;
        }
        return {
            ...run.snapshot,
            meshPeerSignalingReady: this.meshPeerSignalingReadyMap(run),
        };
    }

    setPhase(
        run: AvCallSpaceRun,
        phase: AvCallSessionPhase,
        extra?: Partial<AvCallSessionSnapshot>,
    ): void {
        run.snapshot = {
            ...run.snapshot,
            phase,
            ...extra,
        };
        run.onUpdate();
        avCallRecord("phase", {
            space: shortSpaceId(run.spaceUuid),
            phase,
            sessionId: run.snapshot.sessionId
                ? shortSessionId(run.snapshot.sessionId)
                : undefined,
            hasJoined: run.hasJoined,
            signalingJoined: run.snapshot.signalingJoined,
            kind: run.kind,
        });
    }

    fail(run: AvCallSpaceRun, detail: string): void {
        avCallRecord("failed", {
            space: shortSpaceId(run.spaceUuid),
            detail,
            kind: run.kind,
        });
        this.tearDownSignaling(run, detail);
        run.hasJoined = false;
        if (run.kind === "group") {
            for (const peer of run.meshPeers.values()) {
                peer.dispose();
            }
            run.meshPeers.clear();
            if (run.localStream) {
                for (const t of run.localStream.getTracks()) {
                    t.stop();
                }
                run.localStream = null;
            }
        }
        this.setPhase(run, "failed", {
            lastError: detail,
            signalingJoined: false,
            mediaConnected: run.kind === "dm" ? false : undefined,
            meshPeerSignalingReady:
                run.kind === "group" ? {} : undefined,
        });
    }

    tearDownSignaling(run: AvCallSpaceRun, reason: string): void {
        avCallRecord("tearDownSignaling", {
            space: shortSpaceId(run.spaceUuid),
            reason,
            hadJoined: run.hasJoined,
            kind: run.kind,
        });
        if (run.kind === "dm") {
            this.tearDownDmPeer(run, reason);
        }
        const signaling = this.signaling;
        const sessionId = run.snapshot.sessionId;
        if (signaling && run.hasJoined && sessionId) {
            signaling.leaveSession(sessionId, reason);
            if (run.kind === "group") {
                commitAvCallParticipantLeft(sessionId, reason);
            } else {
                commitAvCallTimelineEvent(sessionId, reason);
            }
        }
        run.hasJoined = false;
        if (run.kind === "group") {
            for (const peer of run.meshPeers.values()) {
                peer.dispose();
            }
            run.meshPeers.clear();
            if (run.localStream) {
                for (const t of run.localStream.getTracks()) {
                    t.stop();
                }
                run.localStream = null;
            }
        }
        if (run.snapshot.signalingJoined || run.snapshot.mediaConnected) {
            run.snapshot = {
                ...run.snapshot,
                signalingJoined: false,
                mediaConnected: run.kind === "dm" ? false : run.snapshot.mediaConnected,
                meshPeerSignalingReady:
                    run.kind === "group" ? {} : run.snapshot.meshPeerSignalingReady,
            };
            run.onUpdate();
        }
    }

    tearDownDmPeer(run: DmAvCallRun, reason: string): void {
        tearDownDmAvCallPeer(this, run, reason);
    }

    tearDownMeshSignalingPeer(
        run: GroupAvCallRun,
        remoteAccount: string,
        reason: string,
    ): void {
        tearDownMeshSignalingPeer(this, run, remoteAccount, reason);
    }

    retireAvCallSession(sessionId: string): void {
        this.retiredAvCallSessionIds.add(sessionId);
    }

    unretireAvCallSession(sessionId: string): void {
        this.retiredAvCallSessionIds.delete(sessionId);
    }

    isRetiredAvCallSession(sessionId: string): boolean {
        return this.retiredAvCallSessionIds.has(sessionId);
    }

    recordAvCallSessionSnapshot(
        sessionId: string,
        joinedParticipants: string[],
        pendingParticipants: string[],
    ): void {
        if (sessionId.startsWith("wrtc:pair:")) return;
        this.avCallSessionRosters.set(sessionId, {
            joined: [...joinedParticipants],
            pending: [...pendingParticipants],
        });
    }

    removeParticipantFromAvCallSessionRoster(
        sessionId: string,
        participant: string,
    ): void {
        if (sessionId.startsWith("wrtc:pair:")) return;
        const roster = this.avCallSessionRosters.get(sessionId);
        if (!roster) return;
        this.avCallSessionRosters.set(sessionId, {
            joined: roster.joined.filter((p) => p !== participant),
            pending: roster.pending.filter((p) => p !== participant),
        });
    }

    private othersStillJoinedInAvCallSession(
        sessionId: string,
        self: string,
    ): boolean {
        const roster = this.avCallSessionRosters.get(sessionId);
        if (!roster) return false;
        return roster.joined.some((p) => p !== self);
    }

    /** Whether other participants remain in an active group Meet session. */
    othersStillJoinedInGroupMeet(sessionId: string, self: string): boolean {
        return this.othersStillJoinedInAvCallSession(sessionId, self);
    }

    getAvCallSessionRosterJoinedCount(sessionId: string): number {
        return this.avCallSessionRosters.get(sessionId)?.joined.length ?? 0;
    }

    /**
     * Objective av-call session can outlive x-webrtcsig after everyone leaves
     * signaling. Close the stale row and create a fresh session before retrying.
     */
    async recoverStaleAvCallSession(
        run: AvCallSpaceRun,
        staleSessionId: string,
    ): Promise<void> {
        const signal = run.abort.signal;
        if (signal.aborted) return;

        avCallLog("recoverStaleAvCallSession", {
            space: shortSpaceId(run.spaceUuid),
            sessionId: shortSessionId(staleSessionId),
        });

        this.retireAvCallSession(staleSessionId);
        this.avCallSessionRosters.delete(staleSessionId);
        if (signal.aborted) return;

        run.hasJoined = false;
        if (run.kind === "group") {
            for (const peer of run.meshPeers.values()) {
                peer.dispose();
            }
            run.meshPeers.clear();
            tearDownGroupLocalMedia(run);
        }
        run.snapshot = {
            ...run.snapshot,
            sessionId: undefined,
            signalingJoined: false,
            meshPeerSignalingReady:
                run.kind === "group" ? {} : run.snapshot.meshPeerSignalingReady,
        };

        try {
            await createAvCallSession(run.spaceUuid, run.members);
            const session = await waitForActiveAvCallSession(run.spaceUuid);
            if (signal.aborted) return;
            if (!session) {
                this.fail(run, "av-call session was not created on chain");
                return;
            }

            const self = this.getSelf();
            if (!self) {
                this.fail(run, "Not signed in");
                return;
            }

            let anyPeerOnline = true;
            if (run.kind === "group") {
                anyPeerOnline = remoteMembers(run.members, self).some(
                    (m) => this.getPeerPresence()[m] === "online",
                );
            } else {
                anyPeerOnline =
                    this.getPeerPresence()[run.peerAccount] === "online";
            }

            this.dispatchRunEventForRun(run, {
                type: "sessionResolved",
                sessionId: session.session_id,
                anyPeerOnline,
            });
        } catch (e) {
            if (signal.aborted) return;
            const detail =
                e instanceof Error
                    ? e.message
                    : "av-call session recovery failed";
            this.fail(run, detail);
        }
    }

    async runPipeline(run: AvCallSpaceRun): Promise<void> {
        const signal = run.abort.signal;
        const self = this.getSelf();
        if (!self) {
            this.fail(run, "Not signed in");
            return;
        }

        try {
            this.dispatchRunEventForRun(run, { type: "pipelineCreating" });
            const existing = await fetchActiveAvCallSession(run.spaceUuid);
            if (signal.aborted) return;

            // After a full group hangup the objective session row can remain
            // active while x-webrtcsig has torn down. Host re-start must mint a
            // fresh session so joinSession fans out new sessionInvites.
            // Do not recover when others are still joined (partial leave rejoin).
            if (
                run.kind === "group" &&
                existing?.lifecycle === 1 &&
                !run.hasJoined &&
                !run.snapshot.signalingJoined &&
                !this.othersStillJoinedInAvCallSession(
                    existing.session_id,
                    self,
                )
            ) {
                await this.recoverStaleAvCallSession(
                    run,
                    existing.session_id,
                );
                return;
            }

            const retiredActive =
                existing?.lifecycle === 1 &&
                this.isRetiredAvCallSession(existing.session_id);

            if (!existing || existing.lifecycle !== 1 || retiredActive) {
                await createAvCallSession(run.spaceUuid, run.members);
            }

            const session: ChatSessionEntry | null =
                await waitForActiveAvCallSession(run.spaceUuid);
            if (signal.aborted) return;
            if (!session) {
                this.fail(run, "av-call session was not created on chain");
                return;
            }

            let anyPeerOnline = true;
            if (run.kind === "group") {
                anyPeerOnline = remoteMembers(run.members, self).some(
                    (m) => this.getPeerPresence()[m] === "online",
                );
            } else {
                anyPeerOnline =
                    this.getPeerPresence()[run.peerAccount] === "online";
            }

            this.dispatchRunEventForRun(run, {
                type: "sessionResolved",
                sessionId: session.session_id,
                anyPeerOnline,
            });
        } catch (e) {
            if (signal.aborted) return;
            const detail =
                e instanceof Error
                    ? e.message
                    : "av-call session orchestration failed";
            const staleId = run.snapshot.sessionId;
            if (
                staleId &&
                (detail.includes("session-not-active") ||
                    detail.includes("not-joined"))
            ) {
                await this.recoverStaleAvCallSession(run, staleId);
                return;
            }
            this.fail(run, detail);
        }
    }

    async beginSignaling(
        run: AvCallSpaceRun,
        sessionId: string,
    ): Promise<void> {
        await this.beginSignalingInner(run, sessionId);
    }

    private wireRealtime(): void {
        if (this.realtimeHandlersInstalled) return;
        if (
            !wireAvCallRealtimeHandlers(
                this,
                this.getSharedSignalingFn?.() ?? null,
            )
        ) {
            return;
        }
        this.realtimeHandlersInstalled = true;
    }

    private async beginSignalingInner(
        run: AvCallSpaceRun,
        sessionId: string,
    ): Promise<void> {
        const signal = run.abort.signal;
        const self = this.getSelf();
        if (!self || signal.aborted) return;

        if (run.kind === "dm") {
            if (beginSignalingDmAvCallSkipChecks(this, run, sessionId)) {
                return;
            }
        } else if (beginSignalingGroupAvCallSkipChecks(this, run, sessionId)) {
            return;
        }

        const rt = this.getRealtime();
        const signaling = this.signaling;
        if (!rt?.isSessionReady || !signaling) {
            avCallLog("beginSignaling deferred: ws not ready", {
                sessionReady: rt?.isSessionReady ?? false,
                hasSignaling: !!signaling,
            });
            this.setPhase(run, "waiting-peer", { sessionId });
            return;
        }

        if (run.kind === "group") {
            await beginSignalingGroupAvCall(this, run, sessionId, self);
            return;
        }

        beginSignalingDmAvCall(this, run, sessionId, self);
    }
}

export { dmPeerAccount, shouldInitiateOffer };
