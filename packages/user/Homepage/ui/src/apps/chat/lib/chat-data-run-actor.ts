import { chatDataLog, shortSessionId, shortSpaceId } from "./chat-data-debug";
import {
    ensureConnection,
    releaseAllConnections,
    releaseConnection,
} from "./chat-data-connection-reconciler";
import { beginSignalingDm } from "./chat-data-dm-orchestrator";
import {
    beginSignalingGroup,
    syncMeshPeers,
} from "./chat-data-group-orchestrator";
import { shouldPushDmHistoryOnConnect } from "./dm-history-sync";
import { shouldPushGroupHistoryOnConnect } from "./group-history-sync";
import {
    deriveSnapshot,
    snapshotToMachineState,
    transition,
    type RunCommand,
    type RunEvent,
    type RunMachineState,
} from "./chat-data-run-state-machine";
import {
    shouldInitiateOffer,
    type ChatDataOrchestratorHost,
    type SpaceRun,
} from "./chat-data-session-types";

export function buildRunContext(host: ChatDataOrchestratorHost, run: SpaceRun) {
    const self = host.getSelf() ?? "";
    const livePeerReady: Record<string, boolean> = {};
    const hasActivePeer: Record<string, boolean> = {};
    const peerNeedsReconnect: Record<string, boolean> = {};
    if (run.kind === "dm") {
        livePeerReady[run.peerAccount] = run.peer?.dataChannelReady ?? false;
        hasActivePeer[run.peerAccount] =
            !!run.peer && !run.peer.isDisposed;
        peerNeedsReconnect[run.peerAccount] =
            run.peer?.needsReconnect ?? false;
    } else {
        for (const [acct, peer] of run.meshPeers) {
            livePeerReady[acct] = peer.dataChannelReady;
            hasActivePeer[acct] = !peer.isDisposed;
            peerNeedsReconnect[acct] = peer.needsReconnect;
        }
    }
    return {
        spaceUuid: run.spaceUuid,
        kind: run.kind,
        members: run.members,
        self,
        presence: host.getPeerPresence(),
        livePeerReady,
        hasJoined: run.hasJoined,
        joinSessionRequested: run.joinSessionRequested,
        hasActivePeer,
        peerNeedsReconnect,
    };
}

/**
 * Minimal contract the actor depends on. Tests can provide a recording stub
 * implementing just this method instead of subclassing the production
 * executor (which has private state for host wiring).
 */
export interface RunCommandExecutor {
    execute(
        run: SpaceRun,
        command: RunCommand,
        syncSnapshot: () => void,
    ): void | Promise<void>;
}

export class ChatDataRunCommandExecutor implements RunCommandExecutor {
    constructor(private readonly host: ChatDataOrchestratorHost) {}

    /**
     * Execute one command. Returns void synchronously for in-memory commands
     * so the actor's drain loop can dispatch many of them per microtask;
     * returns a Promise only when the command actually performs I/O that must
     * complete before the next mailbox event runs (pipeline, beginSignaling,
     * applyRemoteSignal, leaveSession). The drain loop conditionally awaits.
     */
    execute(
        run: SpaceRun,
        command: RunCommand,
        syncSnapshot: () => void,
    ): void | Promise<void> {
        switch (command.type) {
            case "logIgnored":
                chatDataLog("run event ignored", {
                    space: shortSpaceId(run.spaceUuid),
                    reason: command.reason,
                    eventType: command.event.type,
                });
                return;

            case "runPipeline":
                return this.host.runPipeline(run);

            case "beginSignaling":
                return this.beginSignaling(run, command.sessionId, syncSnapshot);

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
                const welcomeGeneration =
                    this.host.getRealtime()?.welcomeGeneration ?? 0;
                if (signaling) {
                    signaling.joinSession(command.sessionId);
                    run.joinSessionRequested = true;
                    run.joinedWelcomeGeneration = welcomeGeneration;
                }
                return;
            }

            case "leaveSession": {
                const signaling = this.host.getSignaling();
                signaling?.leaveSession(command.sessionId, command.reason);
                run.hasJoined = false;
                run.joinSessionRequested = false;
                run.joinedWelcomeGeneration = 0;
                return;
            }

            case "createPeer":
                this.createPeer(run, command.sessionId, command.remoteAccount);
                syncSnapshot();
                return;

            case "disposePeer":
                releaseConnection(
                    this.host,
                    run,
                    command.remoteAccount,
                    "command",
                );
                syncSnapshot();
                return;

            case "disposeAllPeers":
                releaseAllConnections(run);
                run.hasJoined = false;
                run.joinSessionRequested = false;
                run.joinedWelcomeGeneration = 0;
                syncSnapshot();
                return;

            case "applyRemoteSignal":
                return this.applyRemoteSignal(run, command, syncSnapshot);

            case "scheduleRecovery":
                this.host.scheduleTransportRecovery(run);
                return;

            case "cancelRecovery":
                this.host.cancelTransportRecovery(run);
                return;

            case "flushPending":
                if (command.recipients.length > 0) {
                    this.host.onFlushPendingRecipients?.(
                        run.spaceUuid,
                        command.recipients,
                    );
                }
                return;

            case "notifyDataChannelReady":
                run.transportRecoveryAttempt = 0;
                if (run.kind === "dm") {
                    this.host.onDataChannelReady?.(run.spaceUuid, {
                        peerAccount: command.remoteAccount,
                        shouldPushHistory: shouldPushDmHistoryOnConnect(
                            run.peerWasOnlineAtSessionStart,
                        ),
                    });
                } else {
                    const remote = command.remoteAccount;
                    const presence = this.host.getPeerPresence();
                    const hadOpen =
                        run.peerHadOpenDataChannel.get(remote) ?? false;
                    this.host.onDataChannelReady?.(run.spaceUuid, {
                        peerAccount: remote,
                        shouldPushHistory: shouldPushGroupHistoryOnConnect(
                            run.peerOnlineAtSessionStart.get(remote) ?? false,
                            {
                                peerIsOnlineNow: presence[remote] === "online",
                                hadOpenDataChannel: hadOpen,
                            },
                        ),
                    });
                    run.peerHadOpenDataChannel.set(remote, true);
                }
                return;

            case "abortRun":
                // Abort the in-flight pipeline (if any) AND install a fresh
                // AbortController so any subsequent `runPipeline` command in
                // the same drain pass can actually execute. Without the
                // refresh, ensure-from-failed degenerated into a silent
                // no-op because `runPipeline` early-returns on
                // `signal.aborted` — the bug pattern that wedged
                // send-after-rejoin.
                run.abort.abort();
                run.abort = new AbortController();
                return;

            default:
                return;
        }
    }

    private async applyRemoteSignal(
        run: SpaceRun,
        command: Extract<RunCommand, { type: "applyRemoteSignal" }>,
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
        await peer.handleRemoteSignal({
            from: command.remoteAccount,
            ...command.signal,
        });
    }

    /**
     * Phase C: `createPeer` is now a thin shim over the unified
     * {@link ensureConnection} reconciler. DM and group share the same
     * "reuse or rebuild" logic; this used to be the third copy of that
     * code path.
     */
    private createPeer(
        run: SpaceRun,
        sessionId: string,
        remoteAccount: string,
    ): void {
        const self = this.host.getSelf();
        if (!self) return;
        ensureConnection(this.host, run, sessionId, self, remoteAccount);
    }

    /**
     * Idempotently reconcile transport for `sessionId`:
     *   - if !hasJoined: send `joinSession` to x-webrtcsig (idempotent on
     *     server when sent twice on the same socket: server treats it as
     *     "re-emit invite")
     *   - for each remote we should have a WebRTC peer for: reuse the
     *     existing peer if its sessionId matches and it isn't disposed,
     *     otherwise create a new one.
     *
     * Every call records why it ran or didn't — silent early-returns are
     * one of the main reasons send-after-rejoin used to wedge.
     */
    private async beginSignaling(
        run: SpaceRun,
        sessionId: string,
        syncSnapshot: () => void,
    ): Promise<void> {
        const signal = run.abort.signal;
        const self = this.host.getSelf();
        if (!self) {
            chatDataLog("beginSignaling no-op: no self", {
                space: shortSpaceId(run.spaceUuid),
                sessionId: shortSessionId(sessionId),
            });
            return;
        }
        if (signal.aborted) {
            chatDataLog("beginSignaling no-op: run aborted", {
                space: shortSpaceId(run.spaceUuid),
                sessionId: shortSessionId(sessionId),
            });
            return;
        }

        const rt = this.host.getRealtime();
        const signaling = this.host.getSignaling();
        if (!rt?.isSessionReady || !signaling) {
            chatDataLog("beginSignaling deferred: ws not ready", {
                space: shortSpaceId(run.spaceUuid),
                sessionId: shortSessionId(sessionId),
                sessionReady: rt?.isSessionReady ?? false,
                hasSignaling: !!signaling,
            });
            return;
        }

        if (run.kind === "group") {
            beginSignalingGroup(this.host, run, sessionId, self);
        } else {
            beginSignalingDm(this.host, run, sessionId, self);
        }
        syncSnapshot();
    }
}

type MailboxEntry = {
    event: RunEvent;
    resolve?: () => void;
};

export class RunActor {
    machineState: RunMachineState;

    private readonly mailbox: MailboxEntry[] = [];

    private draining = false;

    constructor(
        readonly run: SpaceRun,
        private readonly host: ChatDataOrchestratorHost,
        private readonly executor: RunCommandExecutor,
        initialState?: RunMachineState,
    ) {
        this.machineState =
            initialState ?? snapshotToMachineState(run.snapshot);
    }

    dispatch(event: RunEvent): void {
        this.mailbox.push({ event });
        if (!this.draining) {
            void this.drain();
        }
    }

    dispatchAndWait(event: RunEvent): Promise<void> {
        return new Promise((resolve) => {
            this.mailbox.push({ event, resolve });
            if (!this.draining) {
                void this.drain();
            }
        });
    }

    syncSnapshot(): void {
        const ctx = buildRunContext(this.host, this.run);
        this.run.snapshot = deriveSnapshot(this.machineState, ctx);
        this.run.onUpdate();
    }

    getSnapshot() {
        const ctx = buildRunContext(this.host, this.run);
        this.run.snapshot = deriveSnapshot(this.machineState, ctx);
        return this.run.snapshot;
    }

    private async drain(): Promise<void> {
        if (this.draining) return;
        this.draining = true;
        try {
            while (this.mailbox.length > 0) {
                const entry = this.mailbox.shift()!;
                const ctx = buildRunContext(this.host, this.run);
                try {
                    const { state, commands } = transition(
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
                } catch (err) {
                    // Don't let a single bad event wedge the whole actor.
                    // We log so the wedge that used to be silent is now
                    // visible in the console + ring buffer.
                    chatDataLog("actor drain error", {
                        space: shortSpaceId(this.run.spaceUuid),
                        eventType: entry.event.type,
                        error:
                            err instanceof Error
                                ? `${err.name}: ${err.message}`
                                : String(err),
                    });
                }
                entry.resolve?.();
            }
        } finally {
            this.draining = false;
        }
    }
}

export function createRunActor(
    run: SpaceRun,
    host: ChatDataOrchestratorHost,
    executor?: RunCommandExecutor,
): RunActor {
    return new RunActor(
        run,
        host,
        executor ?? new ChatDataRunCommandExecutor(host),
    );
}

