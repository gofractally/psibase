import { avCallLog, shortSpaceId } from "./av-call-debug";
import {
    beginSignalingDmAvCall,
    beginSignalingDmAvCallSkipChecks,
    startDmAvCallPeer,
} from "./av-call-dm-orchestrator";
import {
    beginSignalingGroupAvCall,
    ensureGroupLocalMedia,
    startMeshAvCallPeer,
    tearDownGroupLocalMedia,
    tearDownMeshAvCallPeer,
} from "./av-call-group-orchestrator";
import {
    avTransition,
    avSnapshotToMachineState,
    deriveAvSnapshot,
    type AvRunCommand,
    type AvRunEvent,
    type AvRunMachineState,
} from "./av-call-run-state-machine";
import {
    shouldInitiateOffer,
    type AvCallIncomingInvite,
    type AvCallOrchestratorHost,
    type AvCallSpaceRun,
    type DmAvCallRun,
    type GroupAvCallRun,
} from "./av-call-session-types";
import { commitAvCallTimelineEvent } from "./av-call-timeline-commit";

export function buildAvRunContext(
    host: AvCallOrchestratorHost,
    run: AvCallSpaceRun,
) {
    const self = host.getSelf() ?? "";
    const liveMediaReady: Record<string, boolean> = {};
    const hasActivePeer: Record<string, boolean> = {};
    let hasLocalStream = false;
    if (run.kind === "dm") {
        liveMediaReady[run.peerAccount] =
            run.peer?.isMediaConnected ?? false;
        hasActivePeer[run.peerAccount] =
            !!run.peer && !run.peer.isDisposed;
    } else {
        for (const [acct, peer] of run.meshPeers) {
            liveMediaReady[acct] = peer.isMediaConnected;
            hasActivePeer[acct] = !peer.isDisposed;
        }
        hasLocalStream = !!run.localStream;
    }
    return {
        spaceUuid: run.spaceUuid,
        kind: run.kind,
        members: run.members,
        self,
        presence: host.getPeerPresence(),
        liveMediaReady,
        hasActivePeer,
        hasJoined: run.hasJoined,
        hasLocalStream,
    };
}

/**
 * Minimal contract the actor depends on. Tests can provide a recording stub
 * implementing just this method instead of subclassing the production
 * executor (which has private state for host wiring).
 */
export interface AvRunCommandExecutor {
    execute(
        run: AvCallSpaceRun,
        command: AvRunCommand,
        syncSnapshot: () => void,
    ): void | Promise<void>;
}

export class AvCallRunCommandExecutor implements AvRunCommandExecutor {
    constructor(private readonly host: AvCallOrchestratorHost) {}

    execute(
        run: AvCallSpaceRun,
        command: AvRunCommand,
        syncSnapshot: () => void,
    ): void | Promise<void> {
        switch (command.type) {
            case "logIgnored":
                avCallLog("av-call run event ignored", {
                    space: shortSpaceId(run.spaceUuid),
                    reason: command.reason,
                    eventType: command.event.type,
                });
                return;

            case "runPipeline":
                return this.host.runPipeline(run);

            case "beginSignaling":
                return this.beginSignaling(
                    run,
                    command.sessionId,
                    syncSnapshot,
                );

            case "resendOffer": {
                const peer =
                    run.kind === "dm"
                        ? run.peer
                        : run.meshPeers.get(command.remoteAccount);
                peer?.resendOffer();
                return;
            }

            case "joinSession": {
                const signaling = this.host.getSignaling();
                signaling?.joinSession(command.sessionId);
                run.hasJoined = true;
                return;
            }

            case "leaveSession": {
                const signaling = this.host.getSignaling();
                signaling?.leaveSession(command.sessionId, command.reason);
                run.hasJoined = false;
                return;
            }

            case "createPeer":
                this.createPeer(run, command.sessionId, command.remoteAccount);
                syncSnapshot();
                return;

            case "disposePeer":
                if (run.kind === "group") {
                    tearDownMeshAvCallPeer(
                        this.host,
                        run,
                        command.remoteAccount,
                        "command",
                    );
                } else if (run.peerAccount === command.remoteAccount) {
                    this.host.tearDownDmPeer(run, "command");
                }
                syncSnapshot();
                return;

            case "disposeAllPeers":
                this.disposeAllPeers(run);
                run.hasJoined = false;
                syncSnapshot();
                return;

            case "acquireLocalMedia":
                if (run.kind === "group") {
                    return ensureGroupLocalMedia(run).then(() => {});
                }
                return;

            case "releaseLocalMedia":
                if (run.kind === "group") {
                    tearDownGroupLocalMedia(run);
                }
                syncSnapshot();
                return;

            case "applyRemoteSignal":
                return this.applyRemoteSignal(run, command, syncSnapshot);

            case "scheduleRecovery":
                this.host.scheduleTransportRecovery?.(run);
                return;

            case "cancelRecovery":
                this.host.cancelTransportRecovery?.(run);
                return;

            case "notifyMediaReady":
                run.transportRecoveryAttempt = 0;
                if (run.kind === "dm") {
                    const local = run.peer?.getLocalStream();
                    if (local) {
                        this.host.onAvCallMediaReady?.(run.spaceUuid, {
                            peerAccount: command.remoteAccount,
                            localStream: local,
                            remoteStream:
                                run.peer?.getRemoteStream() ?? null,
                        });
                    }
                } else {
                    const meshPeer = run.meshPeers.get(command.remoteAccount);
                    const local =
                        run.localStream ?? meshPeer?.getLocalStream();
                    if (local && meshPeer) {
                        this.host.onAvCallMediaReady?.(run.spaceUuid, {
                            peerAccount: command.remoteAccount,
                            localStream: local,
                            remoteStream: meshPeer.getRemoteStream(),
                        });
                    }
                }
                return;

            case "commitTimelineEvent":
                commitAvCallTimelineEvent(command.sessionId, command.reason);
                return;

            case "notifyPendingInvite": {
                const invite: AvCallIncomingInvite = {
                    sessionId: command.sessionId,
                    spaceUuid: run.spaceUuid,
                    from: command.from,
                    wantVideo: command.wantVideo,
                    wantAudio: command.wantAudio,
                    participants: [...run.members],
                };
                this.host.setPendingInvite(invite);
                return;
            }

            case "clearPendingInvite":
                this.host.onInviteCleared?.(command.sessionId);
                return;

            case "abortRun":
                run.abort.abort();
                return;

            default:
                return;
        }
    }

    private async applyRemoteSignal(
        run: AvCallSpaceRun,
        command: Extract<AvRunCommand, { type: "applyRemoteSignal" }>,
        syncSnapshot: () => void,
    ): Promise<void> {
        const self = this.host.getSelf();
        if (!self) return;
        let peer =
            run.kind === "dm"
                ? run.peer
                : run.meshPeers.get(command.remoteAccount);
        if (!peer) {
            const sessionId = run.snapshot.sessionId;
            if (!sessionId) return;
            await this.beginSignaling(run, sessionId, syncSnapshot);
            peer =
                run.kind === "dm"
                    ? run.peer
                    : run.meshPeers.get(command.remoteAccount);
        }
        if (!peer) return;
        await peer.handleRemoteSignal?.({
            from: command.remoteAccount,
            ...command.signal,
        });
    }

    private disposeAllPeers(run: AvCallSpaceRun): void {
        if (run.kind === "dm") {
            this.host.tearDownDmPeer(run, "disposeAll");
        } else {
            for (const peer of run.meshPeers.values()) {
                peer.dispose();
            }
            run.meshPeers.clear();
            tearDownGroupLocalMedia(run);
        }
    }

    private createPeer(
        run: AvCallSpaceRun,
        sessionId: string,
        remoteAccount: string,
    ): void {
        const self = this.host.getSelf();
        if (!self) return;
        if (run.kind === "dm") {
            startDmAvCallPeer(
                this.host,
                run,
                sessionId,
                self,
                shouldInitiateOffer(self, remoteAccount),
            );
            return;
        }
        startMeshAvCallPeer(this.host, run, sessionId, self, remoteAccount);
    }

    private async beginSignaling(
        run: AvCallSpaceRun,
        sessionId: string,
        syncSnapshot: () => void,
    ): Promise<void> {
        const signal = run.abort.signal;
        const self = this.host.getSelf();
        if (!self || signal.aborted) return;

        if (run.kind === "dm" && beginSignalingDmAvCallSkipChecks(run, sessionId)) {
            return;
        }

        const rt = this.host.getRealtime();
        const signaling = this.host.getSignaling();
        if (!rt?.isSessionReady || !signaling) {
            avCallLog("av-call beginSignaling deferred: ws not ready", {
                sessionReady: rt?.isSessionReady ?? false,
                hasSignaling: !!signaling,
            });
            return;
        }

        if (run.kind === "group") {
            await beginSignalingGroupAvCall(this.host, run, sessionId, self);
        } else {
            beginSignalingDmAvCall(this.host, run, sessionId, self);
        }
        syncSnapshot();
    }
}

type AvMailboxEntry = {
    event: AvRunEvent;
    resolve?: () => void;
};

export class AvRunActor {
    machineState: AvRunMachineState;

    private readonly mailbox: AvMailboxEntry[] = [];

    private draining = false;

    constructor(
        readonly run: AvCallSpaceRun,
        private readonly host: AvCallOrchestratorHost,
        private readonly executor: AvRunCommandExecutor,
        initialState?: AvRunMachineState,
    ) {
        this.machineState =
            initialState ?? avSnapshotToMachineState(run.snapshot);
    }

    dispatch(event: AvRunEvent): void {
        this.mailbox.push({ event });
        if (!this.draining) {
            void this.drain();
        }
    }

    dispatchAndWait(event: AvRunEvent): Promise<void> {
        return new Promise((resolve) => {
            this.mailbox.push({ event, resolve });
            if (!this.draining) {
                void this.drain();
            }
        });
    }

    syncSnapshot(): void {
        const ctx = buildAvRunContext(this.host, this.run);
        this.run.snapshot = deriveAvSnapshot(this.machineState, ctx);
        this.run.onUpdate();
    }

    getSnapshot() {
        const ctx = buildAvRunContext(this.host, this.run);
        this.run.snapshot = deriveAvSnapshot(this.machineState, ctx);
        return this.run.snapshot;
    }

    private async drain(): Promise<void> {
        if (this.draining) return;
        this.draining = true;
        try {
            while (this.mailbox.length > 0) {
                const entry = this.mailbox.shift()!;
                const ctx = buildAvRunContext(this.host, this.run);
                const { state, commands } = avTransition(
                    this.machineState,
                    entry.event,
                    ctx,
                );
                this.machineState = state;
                this.syncSnapshot();
                for (const command of commands) {
                    const result = this.executor.execute(
                        this.run,
                        command,
                        () => this.syncSnapshot(),
                    );
                    if (result instanceof Promise) await result;
                }
                this.syncSnapshot();
                entry.resolve?.();
            }
        } finally {
            this.draining = false;
        }
    }
}

export function createAvRunActor(
    run: AvCallSpaceRun,
    host: AvCallOrchestratorHost,
    executor?: AvRunCommandExecutor,
): AvRunActor {
    return new AvRunActor(
        run,
        host,
        executor ?? new AvCallRunCommandExecutor(host),
    );
}

/**
 * Helper for callsites that today create runs with a hand-rolled snapshot.
 * Returns the SpaceRun shape with snapshot derived from initialAvCallRunSnapshot
 * so phase changes flow through `deriveAvSnapshot`.
 */
export function buildDmAvCallRun(args: {
    host: AvCallOrchestratorHost;
    spaceUuid: string;
    members: readonly string[];
    self: string;
    peerAccount: string;
    wantVideo: boolean;
    wantAudio: boolean;
    sessionId?: string;
    incomingInvite?: { from: string; wantVideo: boolean; wantAudio: boolean };
}): DmAvCallRun {
    const run: DmAvCallRun = {
        kind: "dm",
        spaceUuid: args.spaceUuid,
        members: [...args.members],
        peerAccount: args.peerAccount,
        wantVideo: args.wantVideo,
        wantAudio: args.wantAudio,
        peer: null,
        abort: new AbortController(),
        snapshot: {
            spaceUuid: args.spaceUuid,
            phase: "ensuring",
            signalingJoined: false,
            mediaConnected: false,
        },
        hasJoined: false,
        transportRecoveryAttempt: 0,
        onUpdate: () => {
            args.host.onSpaceUpdate?.(
                args.spaceUuid,
                args.host.liveSnapshot(run),
            );
        },
    };
    return run;
}

export function buildGroupAvCallRun(args: {
    host: AvCallOrchestratorHost;
    spaceUuid: string;
    members: readonly string[];
    self: string;
    wantVideo: boolean;
    wantAudio: boolean;
    sessionId?: string;
    peerOnlineAtSessionStart?: Map<string, boolean>;
}): GroupAvCallRun {
    const run: GroupAvCallRun = {
        kind: "group",
        spaceUuid: args.spaceUuid,
        members: [...args.members],
        meshPeers: new Map(),
        wantVideo: args.wantVideo,
        wantAudio: args.wantAudio,
        localStream: null,
        peerOnlineAtSessionStart:
            args.peerOnlineAtSessionStart ?? new Map(),
        abort: new AbortController(),
        snapshot: {
            spaceUuid: args.spaceUuid,
            phase: "ensuring",
            signalingJoined: false,
            meshPeerSignalingReady: {},
        },
        hasJoined: false,
        transportRecoveryAttempt: 0,
        onUpdate: () => {
            args.host.onSpaceUpdate?.(
                args.spaceUuid,
                args.host.liveSnapshot(run),
            );
        },
    };
    return run;
}
