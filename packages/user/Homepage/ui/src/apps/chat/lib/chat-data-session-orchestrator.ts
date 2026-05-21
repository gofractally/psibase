import {
    createChatDataSession,
    fetchActiveChatDataSession,
    waitForActiveChatDataSession,
    type ChatSessionEntry,
} from "./chat-api";
import { ChatDataWebRtcPeer } from "./chat-data-webrtc-peer";
import {
    chatDataLog,
    chatDataRecord,
    shortSessionId,
    shortSpaceId,
} from "./chat-data-debug";
import type {
    ChatDataMessageEnvelope,
    ChatHistorySyncEnvelope,
} from "./chat-data-envelope";
import {
    ensureDmChatDataSession,
    releaseIdleDmTransport,
} from "./chat-data-dm-orchestrator";
import {
    allOnlineMeshPeersReady,
    beginSignalingGroup,
    ensureGroupChatDataSession,
    tearDownMeshPeer,
} from "./chat-data-group-orchestrator";
import { wireChatDataRealtimeHandlers } from "./chat-data-realtime-handlers";
import type { RegisterRealtimeHandlersFn } from "./chat-data-realtime-handlers";
import {
    remoteMembers,
    type ChatDataOrchestratorHost,
    type ChatDataSessionSnapshot,
    type GroupSpaceRun,
    type SpaceRun,
} from "./chat-data-session-types";
import type { IceServerConfig } from "./protocol";
import type { RealtimeClient } from "./realtime-client";
import type { WebRtcSignalingClient } from "./webrtc-signaling-client";
import {
    createRunActor,
    ChatDataRunCommandExecutor,
    type RunActor,
} from "./chat-data-run-actor";
import type { RunEvent } from "./chat-data-run-state-machine";
import { TransportRecoveryManager } from "./transport-recovery";

export type {
    ChatDataSessionPhase,
    ChatDataSessionSnapshot,
    DmSpaceRun,
    GroupSpaceRun,
    SpaceRun,
} from "./chat-data-session-types";

/**
 * Lazy per-space background orchestration: objective createSession(chat-data)
 * then x-webrtcsig joinSession + WebRTC signaling (architecture §6.3).
 * DM: one peer connection; group: mesh (one PC per online remote member, §5.3).
 */
export class ChatDataSessionOrchestrator implements ChatDataOrchestratorHost {
    private readonly runs = new Map<string, SpaceRun>();

    private readonly actors = new Map<string, RunActor>();

    private readonly runExecutor = new ChatDataRunCommandExecutor(this);

    private signaling: WebRtcSignalingClient | null = null;

    private realtimeHandlersInstalled = false;

    private unregisterRealtimeHandlers: (() => void) | null = null;

    private reconcileAfterReconnectTimer: ReturnType<
        typeof globalThis.setTimeout
    > | null = null;

    private readonly transportRecovery = new TransportRecoveryManager();

    /** App-reported focused conversation (infra policy; see webrtc-debugging.md H28). */
    private focusedSpaceUuid: string | undefined;

    /** Blocks ensures, mesh nudges, and productive run events during Chat shell leave. */
    private navigationSuspended = false;

    constructor(
        private readonly getRealtimeFn: () => RealtimeClient | null,
        private readonly getSelfFn: () => string | null,
        private readonly getIceServersFn: () => IceServerConfig[] | null,
        private readonly getPeerPresenceFn: () => Record<string, string>,
        readonly onSpaceUpdate?: (
            spaceUuid: string,
            snap: ChatDataSessionSnapshot,
        ) => void,
        readonly onChatMessage?: (
            spaceUuid: string,
            envelope: ChatDataMessageEnvelope,
        ) => void,
        readonly onChatHistorySync?: (
            spaceUuid: string,
            envelope: ChatHistorySyncEnvelope,
        ) => void,
        readonly onDataChannelReady?: (
            spaceUuid: string,
            info: { peerAccount: string; shouldPushHistory: boolean },
        ) => void,
        readonly onChatDataSessionInvite?: (spaceUuid: string) => void,
        /** Plan C3: SM-driven targeted flush triggered by remote DC open. */
        readonly onFlushPendingRecipients?: (
            spaceUuid: string,
            recipients: readonly string[],
        ) => void,
        /**
         * Plan F7: per-recipient delivery acknowledgement. Fires once
         * the remote peer has confirmed receipt of an outbound chat
         * message via an app-level `messageAck` envelope.
         */
        readonly onMessageAck?: (
            spaceUuid: string,
            envelope: import("./chat-data-envelope").ChatDataMessageAckEnvelope,
        ) => void,
    ) {}

    /**
     * Eagerly wire realtime handlers and the WebRTC signaling client onto the
     * RealtimeClient. Callers that construct the orchestrator at chat-shell
     * boot should invoke this so signals delivered between WS welcome and the
     * user opening a DM are not silently dropped (the orchestrator's `signal`
     * handler is the only one that runs `findRunBySessionId`).
     */
    start(registerHandlers: RegisterRealtimeHandlersFn): void {
        this.wireRealtime(registerHandlers);
    }

    getSnapshot(spaceUuid: string): ChatDataSessionSnapshot {
        const run = this.runs.get(spaceUuid);
        if (!run) {
            return {
                spaceUuid,
                phase: "idle",
                dataChannelReady: false,
            };
        }
        return this.getOrCreateActor(run).getSnapshot();
    }

    getOrCreateActor(run: SpaceRun): RunActor {
        let actor = this.actors.get(run.spaceUuid);
        if (!actor) {
            actor = createRunActor(run, this, this.runExecutor);
            this.actors.set(run.spaceUuid, actor);
        }
        return actor;
    }

    dispatchRunEventForRun(run: SpaceRun, event: RunEvent): void {
        if (
            this.navigationSuspended &&
            !this.isTeardownRunEvent(event)
        ) {
            chatDataRecord("run-event-skipped-navigation-suspend", {
                type: event.type,
                space: shortSpaceId(run.spaceUuid),
            });
            return;
        }
        this.getOrCreateActor(run).dispatch(event);
    }

    async dispatchRunEventAndWait(
        run: SpaceRun,
        event: RunEvent,
    ): Promise<void> {
        await this.getOrCreateActor(run).dispatchAndWait(event);
    }

    syncRunSnapshot(run: SpaceRun): void {
        this.getOrCreateActor(run).syncSnapshot();
    }

    ensureDmChatDataSession(
        spaceUuid: string,
        members: readonly string[],
    ): void {
        if (this.navigationSuspended) {
            this.logEnsureSkipped("dm", spaceUuid, "navigation-suspend");
            return;
        }
        if (!this.getRealtime()?.isSessionReady) {
            this.logEnsureSkipped("dm", spaceUuid, "session-not-ready");
            return;
        }
        ensureDmChatDataSession(this, spaceUuid, members);
    }

    ensureGroupChatDataSession(
        spaceUuid: string,
        members: readonly string[],
    ): void {
        if (this.navigationSuspended) {
            this.logEnsureSkipped("group", spaceUuid, "navigation-suspend");
            return;
        }
        if (!this.getRealtime()?.isSessionReady) {
            this.logEnsureSkipped("group", spaceUuid, "session-not-ready");
            return;
        }
        ensureGroupChatDataSession(this, spaceUuid, members);
    }

    /**
     * Unified entry point. Dispatches `ensure` to any existing actor first
     * (so the state machine drives "what to do next") and then routes to the
     * DM/group helper for the run-creation side effects when no run exists.
     */
    ensureChatDataSession(
        spaceUuid: string,
        members: readonly string[],
    ): void {
        if (this.navigationSuspended) {
            this.logEnsureSkipped("unified", spaceUuid, "navigation-suspend");
            return;
        }
        if (!this.getRealtime()?.isSessionReady) {
            this.logEnsureSkipped("unified", spaceUuid, "session-not-ready");
            return;
        }
        const existing = this.runs.get(spaceUuid);
        if (existing) {
            const phase = existing.snapshot.phase;
            if (phase === "signaling" || phase === "ready") {
                const self = this.getSelf();
                if (
                    existing.kind === "group" &&
                    self &&
                    existing.snapshot.sessionId &&
                    !allOnlineMeshPeersReady(this, existing)
                ) {
                    const now = Date.now();
                    if (now - existing.lastMeshNudgeMs >= 2_000) {
                        existing.lastMeshNudgeMs = now;
                        beginSignalingGroup(
                            this,
                            existing,
                            existing.snapshot.sessionId,
                            self,
                        );
                    }
                }
                return;
            }
            const now = Date.now();
            if (now - existing.lastMeshNudgeMs < 2_000) {
                return;
            }
            existing.lastMeshNudgeMs = now;
            this.dispatchRunEventForRun(existing, { type: "ensure" });
            return;
        }
        if (members.length === 2) {
            ensureDmChatDataSession(this, spaceUuid, members);
        } else {
            ensureGroupChatDataSession(this, spaceUuid, members);
        }
    }

    /** Suspend background mesh/ICE while navigating away from Chat (homeNav wedge). */
    suspendForNavigation(): void {
        if (this.navigationSuspended) return;
        this.navigationSuspended = true;
        const runDetails = [...this.runs.values()].map((run) => ({
            space: shortSpaceId(run.spaceUuid),
            kind: run.kind,
            phase: run.snapshot.phase,
            sessionId: run.snapshot.sessionId ?? null,
            hasJoined: run.hasJoined,
            peers:
                run.kind === "group"
                    ? run.meshPeers.size
                    : run.peer
                      ? 1
                      : 0,
        }));
        chatDataRecord("navigation-suspend", {
            runCount: this.runs.size,
            runs: runDetails,
        });
        if (this.reconcileAfterReconnectTimer != null) {
            globalThis.clearTimeout(this.reconcileAfterReconnectTimer);
            this.reconcileAfterReconnectTimer = null;
        }
        const signaling = this.signaling;
        const peersToDispose: Array<{ dispose(): void }> = [];
        const spaceUuids = [...this.runs.keys()];
        for (const spaceUuid of spaceUuids) {
            const run = this.runs.get(spaceUuid);
            if (!run) continue;
            this.cancelTransportRecovery(run);
            run.abort.abort();
            const sessionId = run.snapshot.sessionId;
            if (signaling && sessionId) {
                signaling.leaveSession(sessionId, "navigation-suspend");
            }
            if (run.kind === "dm") {
                if (run.peer) {
                    peersToDispose.push(run.peer);
                    run.peer = null;
                }
            } else {
                for (const peer of run.meshPeers.values()) {
                    peersToDispose.push(peer);
                }
                run.meshPeers.clear();
            }
            this.runs.delete(spaceUuid);
            this.actors.delete(spaceUuid);
        }
        if (peersToDispose.length > 0) {
            chatDataRecord("navigation-suspend-dispose-scheduled", {
                peerCount: peersToDispose.length,
            });
            globalThis.setTimeout(() => {
                chatDataRecord("navigation-suspend-dispose-start", {
                    peerCount: peersToDispose.length,
                });
                for (const peer of peersToDispose) {
                    peer.dispose();
                }
                chatDataRecord("navigation-suspend-dispose-done", {
                    peerCount: peersToDispose.length,
                });
            }, 0);
        }
    }

    resumeAfterNavigation(): void {
        if (!this.navigationSuspended) return;
        this.navigationSuspended = false;
        chatDataRecord("navigation-resume", {});
    }

    isNavigationSuspended(): boolean {
        return this.navigationSuspended;
    }

    /**
     * Join rows are per websocket socket. On reconnect welcome, clear stale
     * join flags immediately so outbound signals are not sent before joinSession
     * on the new socket (server returns not-joined).
     */
    invalidateJoinStateForWelcomeReconnect(): void {
        const welcomeGeneration = this.getRealtime()?.welcomeGeneration ?? 0;
        for (const run of this.runs.values()) {
            if (run.joinedWelcomeGeneration !== welcomeGeneration) {
                chatDataLog("welcome reconnect: invalidate join", {
                    space: shortSpaceId(run.spaceUuid),
                    joinedWelcomeGeneration: run.joinedWelcomeGeneration,
                    welcomeGeneration,
                });
                run.hasJoined = false;
                run.joinSessionRequested = false;
                run.sessionSnapshotEpoch = 0;
            }
        }
    }

    reconcileAfterReconnect(): void {
        if (this.navigationSuspended) return;
        if (this.reconcileAfterReconnectTimer != null) {
            globalThis.clearTimeout(this.reconcileAfterReconnectTimer);
        }
        this.reconcileAfterReconnectTimer = globalThis.setTimeout(() => {
            this.reconcileAfterReconnectTimer = null;
            this.reconcileAfterReconnectNow();
        }, 50);
    }

    onPeerOnline(peerAccount: string): void {
        if (this.navigationSuspended) return;
        if (this.getPeerPresence()[peerAccount] !== "online") {
            return;
        }
        for (const run of this.runs.values()) {
            if (!run.members.includes(peerAccount)) continue;
            this.dispatchRunEventForRun(run, {
                type: "presenceOnline",
                account: peerAccount,
            });
        }
    }

    onPeerOffline(peerAccount: string): void {
        for (const run of this.runs.values()) {
            if (!run.members.includes(peerAccount)) continue;
            this.dispatchRunEventForRun(run, {
                type: "presenceOffline",
                account: peerAccount,
            });
        }
    }

    getPeer(spaceUuid: string): ChatDataWebRtcPeer | null {
        const run = this.runs.get(spaceUuid);
        if (!run) return null;
        if (run.kind === "dm") return run.peer;
        for (const peer of run.meshPeers.values()) {
            if (peer.dataChannelReady) return peer;
        }
        return run.meshPeers.values().next().value ?? null;
    }

    getMeshPeer(
        spaceUuid: string,
        remoteAccount: string,
    ): ChatDataWebRtcPeer | null {
        const run = this.runs.get(spaceUuid);
        if (run?.kind === "group") {
            return run.meshPeers.get(remoteAccount) ?? null;
        }
        if (run?.kind === "dm" && run.peerAccount === remoteAccount) {
            return run.peer;
        }
        return null;
    }

    sendChatMessage(
        spaceUuid: string,
        envelope: ChatDataMessageEnvelope,
    ): boolean {
        return this.getPeer(spaceUuid)?.sendChatMessage(envelope) ?? false;
    }

    sendGroupChatMessage(
        spaceUuid: string,
        targetAccount: string,
        envelope: ChatDataMessageEnvelope,
    ): boolean {
        return (
            this.getMeshPeer(spaceUuid, targetAccount)?.sendChatMessage(
                envelope,
            ) ?? false
        );
    }

    anyGroupDataChannelReady(spaceUuid: string): boolean {
        const run = this.runs.get(spaceUuid);
        if (run?.kind !== "group") return false;
        return this.anyMeshDataChannelReady(run);
    }

    groupMeshPeerReady(spaceUuid: string, remoteAccount: string): boolean {
        return (
            this.getMeshPeer(spaceUuid, remoteAccount)?.dataChannelReady ??
            false
        );
    }

    sendHistorySync(
        spaceUuid: string,
        envelope: ChatHistorySyncEnvelope,
    ): boolean {
        return this.getPeer(spaceUuid)?.sendHistorySync(envelope) ?? false;
    }

    sendGroupHistorySync(
        spaceUuid: string,
        targetAccount: string,
        envelope: ChatHistorySyncEnvelope,
    ): boolean {
        return (
            this.getMeshPeer(spaceUuid, targetAccount)?.sendHistorySync(
                envelope,
            ) ?? false
        );
    }

    releaseIdleTransport(spaceUuid: string): void {
        releaseIdleDmTransport(this, spaceUuid);
    }

    /** Infra focus policy — apps set this when the user selects a conversation. */
    setFocusedSpace(spaceUuid: string | undefined): void {
        this.focusedSpaceUuid = spaceUuid;
    }

    getFocusedSpace(): string | undefined {
        return this.focusedSpaceUuid;
    }

    dispose(): void {
        this.suspendForNavigation();
        const signaling = this.signaling;
        for (const run of this.runs.values()) {
            run.abort.abort();
            if (signaling && run.hasJoined && run.snapshot.sessionId) {
                signaling.leaveSession(run.snapshot.sessionId, "client-disposed");
            }
            if (run.kind === "dm") {
                run.peer?.dispose();
            } else {
                for (const peer of run.meshPeers.values()) {
                    peer.dispose();
                }
                run.meshPeers.clear();
            }
        }
        this.runs.clear();
        this.actors.clear();
        this.realtimeHandlersInstalled = false;
        this.unregisterRealtimeHandlers?.();
        this.unregisterRealtimeHandlers = null;
        this.transportRecovery.dispose();
        if (this.reconcileAfterReconnectTimer != null) {
            globalThis.clearTimeout(this.reconcileAfterReconnectTimer);
            this.reconcileAfterReconnectTimer = null;
        }
        this.signaling = null;
        this.focusedSpaceUuid = undefined;
        this.navigationSuspended = false;
    }

    private logEnsureSkipped(
        kind: "dm" | "group" | "unified",
        spaceUuid: string,
        reason: "navigation-suspend" | "session-not-ready",
    ): void {
        chatDataRecord("ensure-skipped", {
            kind,
            space: shortSpaceId(spaceUuid),
            reason,
        });
    }

    private isTeardownRunEvent(event: RunEvent): boolean {
        switch (event.type) {
            case "dispose":
            case "transportTornDown":
            case "peerLost":
            case "sessionEnded":
            case "presenceOffline":
            case "failed":
                return true;
            default:
                return false;
        }
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

    getSignaling(): WebRtcSignalingClient | null {
        return this.signaling;
    }

    setSignaling(signaling: WebRtcSignalingClient): void {
        this.signaling = signaling;
    }

    getRun(spaceUuid: string): SpaceRun | undefined {
        return this.runs.get(spaceUuid);
    }

    setRun(spaceUuid: string, run: SpaceRun): void {
        this.runs.set(spaceUuid, run);
        this.getOrCreateActor(run);
    }

    deleteRun(spaceUuid: string): void {
        const run = this.runs.get(spaceUuid);
        if (run) {
            this.dispatchRunEventForRun(run, { type: "dispose" });
        }
        this.runs.delete(spaceUuid);
        this.actors.delete(spaceUuid);
    }

    getRuns(): IterableIterator<SpaceRun> {
        return this.runs.values();
    }

    findRunBySessionId(sessionId: string): SpaceRun | undefined {
        for (const run of this.runs.values()) {
            if (run.snapshot.sessionId === sessionId) return run;
        }
        return undefined;
    }

    cancelTransportRecovery(run: SpaceRun): void {
        this.transportRecovery.cancelTransportRecovery(run);
    }

    scheduleTransportRecovery(run: SpaceRun): void {
        this.transportRecovery.scheduleTransportRecovery(run, this);
    }

    async runPipeline(run: SpaceRun): Promise<void> {
        const signal = run.abort.signal;
        const self = this.getSelf();
        if (!self) {
            this.fail(run, "Not signed in");
            return;
        }

        try {
            this.dispatchRunEventForRun(run, { type: "pipelineCreating" });
            const existing = await fetchActiveChatDataSession(run.spaceUuid);
            if (signal.aborted) return;

            if (!existing || existing.lifecycle !== 1) {
                await createChatDataSession(run.spaceUuid, run.members);
            }

            const session: ChatSessionEntry | null =
                await waitForActiveChatDataSession(run.spaceUuid);
            if (signal.aborted) return;
            if (!session) {
                this.fail(run, "chat-data session was not created on chain");
                return;
            }

            let anyPeerOnline = false;
            if (run.kind === "group") {
                anyPeerOnline = remoteMembers(run.members, self).some(
                    (m) => this.getPeerPresence()[m] === "online",
                );
            } else {
                anyPeerOnline =
                    this.getPeerPresence()[run.peerAccount] === "online";
            }

            // Dispatch non-awaiting: if `runPipeline` was invoked as an
            // FSM command (the new Phase A entrypoint), the actor's drain
            // is currently `await`-ing this function. Calling
            // `dispatchAndWait` would deadlock (the new event can't be
            // drained until we return, but we can't return until the event
            // is drained). The next mailbox iteration will pick this up.
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
                    : "chat-data session orchestration failed";
            this.fail(run, detail);
        }
    }

    async beginSignaling(
        run: SpaceRun,
        sessionId: string,
    ): Promise<void> {
        await this.dispatchRunEventAndWait(run, {
            type: "beginSignaling",
            sessionId,
        });
    }

    private wireRealtime(registerHandlers: RegisterRealtimeHandlersFn): void {
        if (this.realtimeHandlersInstalled) return;
        const unregister = wireChatDataRealtimeHandlers(this, registerHandlers);
        if (!unregister) return;
        this.unregisterRealtimeHandlers = unregister;
        this.realtimeHandlersInstalled = true;
    }

    private runDataChannelReady(run: SpaceRun): boolean {
        if (run.kind === "dm") {
            return run.peer?.dataChannelReady ?? false;
        }
        return this.anyMeshDataChannelReady(run);
    }

    private reconcileAfterReconnectNow(): void {
        const rt = this.getRealtime();
        if (!rt?.isSessionReady) return;
        const self = this.getSelf();
        const signaling = this.getSignaling();
        const welcomeGeneration = rt.welcomeGeneration ?? 0;

        chatDataLog("reconcileAfterReconnect", {
            runCount: this.runs.size,
            welcomeGeneration,
        });

        for (const run of this.runs.values()) {
            if (run.joinedWelcomeGeneration !== welcomeGeneration) {
                run.hasJoined = false;
                run.joinSessionRequested = false;
                run.sessionSnapshotEpoch = 0;
            }
        }

        for (const run of this.runs.values()) {
            const snap = this.getOrCreateActor(run).getSnapshot();
            const sessionId = snap.sessionId;
            const phase = snap.phase;

            if (
                phase === "ensuring" ||
                phase === "creating" ||
                !sessionId
            ) {
                continue;
            }

            if (phase === "failed") {
                continue;
            }

            const anyOnline =
                !!self &&
                (run.kind === "group"
                    ? remoteMembers(run.members, self).some(
                          (m) => this.getPeerPresence()[m] === "online",
                      )
                    : this.getPeerPresence()[run.peerAccount] === "online");

            // Websocket reconnect does not invalidate an open data channel.
            // Disposing every peer here was killing working DMs when the user
            // had multiple conversations and the socket flapped (H20).
            if (this.runDataChannelReady(run)) {
                chatDataLog("reconcileAfterReconnect: skip live data channel", {
                    space: shortSpaceId(run.spaceUuid),
                    sessionId: shortSessionId(sessionId),
                });
                if (signaling) {
                    signaling.joinSession(sessionId);
                    run.joinSessionRequested = true;
                }
                continue;
            }

            if (!anyOnline) {
                this.dispatchRunEventForRun(run, {
                    type: "signalingDeferred",
                    sessionId,
                });
                continue;
            }

            this.dispatchRunEventForRun(run, {
                type: "beginSignaling",
                sessionId,
            });
        }
    }

    private meshPeerReadyMap(run: GroupSpaceRun): Record<string, boolean> {
        const out: Record<string, boolean> = {};
        for (const [acct, peer] of run.meshPeers) {
            out[acct] = peer.dataChannelReady;
        }
        return out;
    }

    anyMeshDataChannelReady(run: GroupSpaceRun): boolean {
        for (const peer of run.meshPeers.values()) {
            if (peer.dataChannelReady) return true;
        }
        return false;
    }

    liveSnapshot(run: SpaceRun): ChatDataSessionSnapshot {
        return this.getOrCreateActor(run).getSnapshot();
    }

    fail(run: SpaceRun, detail: string): void {
        chatDataRecord("failed", {
            space: shortSpaceId(run.spaceUuid),
            detail,
        });
        this.dispatchRunEventForRun(run, { type: "failed", detail });
    }

    tearDownTransport(run: SpaceRun, reason: string): void {
        chatDataRecord("tearDownTransport", {
            space: shortSpaceId(run.spaceUuid),
            reason,
            hadJoined: run.hasJoined,
            kind: run.kind,
        });
        this.dispatchRunEventForRun(run, {
            type: "transportTornDown",
            reason,
            sessionId: run.snapshot.sessionId,
        });
    }

    tearDownMeshPeer(
        run: GroupSpaceRun,
        remoteAccount: string,
        reason: string,
    ): void {
        tearDownMeshPeer(this, run, remoteAccount, reason);
        this.syncRunSnapshot(run);
    }
}
