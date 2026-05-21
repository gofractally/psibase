import type { SignalKind } from "./webrtc-signaling-client";
import {
    dmPeerAccount,
    remoteMembers,
    type ChatDataSessionPhase,
    type ChatDataSessionSnapshot,
} from "./chat-data-session-types";

/** Per-remote peer slot in the logical state machine (not the WebRTC peer object). */
export type PeerSlotState = "absent" | "connecting" | "ready";

export type RunMachineState =
    | { tag: "idle" }
    | { tag: "ensuring" }
    | { tag: "creating" }
    | { tag: "waitingPeer"; sessionId: string }
    | { tag: "joining"; sessionId: string }
    | { tag: "signaling"; sessionId: string; peerSlots: Record<string, PeerSlotState> }
    | { tag: "ready"; sessionId: string; peerSlots: Record<string, PeerSlotState> }
    | { tag: "failed"; sessionId?: string; lastError: string };

export type RunKind = "dm" | "group";

export type RunContext = {
    spaceUuid: string;
    kind: RunKind;
    members: readonly string[];
    self: string;
    presence: Readonly<Record<string, string>>;
    /** Live readiness from WebRTC peer objects (authoritative for dataChannelReady). */
    livePeerReady: Readonly<Record<string, boolean>>;
    hasJoined: boolean;
    joinSessionRequested: boolean;
    /** Whether a live WebRTC peer object exists for the remote account. */
    hasActivePeer: Readonly<Record<string, boolean>>;
    /**
     * Peer transport is wedged: SDP stable (or failed) but data channel never
     * opened — safe to dispose and renegotiate when the remote rejoins.
     */
    peerNeedsReconnect: Readonly<Record<string, boolean>>;
};

export type RunEvent =
    | { type: "ensure" }
    | { type: "pipelineCreating" }
    | { type: "sessionResolved"; sessionId: string; anyPeerOnline: boolean }
    | { type: "sessionInvite"; sessionId: string; from: string }
    | { type: "participantJoined"; sessionId: string; participant: string }
    | {
          /**
           * F1: server-authoritative roster delta. Emitted on `sessionSnapshot`
           * frames. `joined` is the set of participants currently joined to
           * the session at the server. This is the FSM's source of truth
           * for who is reachable; `peerSlots` should converge to match.
           */
          type: "rosterUpdated";
          sessionId: string;
          joined: readonly string[];
          pending: readonly string[];
          newJoiners: readonly string[];
      }
    | {
          /**
           * F1: server-emitted recoverable transport drop (websocket died
           * while the session is still active on chain). Dispose the
           * connection to `participant` but do not transition the whole
           * run to `failed`.
           */
          type: "transportLost";
          sessionId: string;
          participant: string;
      }
    | {
          type: "remoteSignal";
          sessionId: string;
          from: string;
          kind: SignalKind;
          sdp?: string;
          candidate?: string;
          sdpMid?: string;
          sdpMLineIndex?: number;
      }
    | { type: "beginSignaling"; sessionId: string }
    | { type: "signalingDeferred"; sessionId: string }
    | { type: "peerOpened"; remoteAccount: string }
    | { type: "peerLost"; remoteAccount: string; detail: string }
    | { type: "transportTornDown"; reason: string; sessionId?: string }
    | { type: "presenceOnline"; account: string }
    | { type: "presenceOffline"; account: string }
    | { type: "recoveryTick"; sessionId: string }
    | {
          type: "sessionEnded";
          sessionId: string;
          reason: string;
          /**
           * Account that triggered the session-ended frame (sent the
           * `leaveSession` to the server). Used to distinguish "self left"
           * (kill the run) from "another participant left" (in groups: keep
           * the run alive, just dispose that mesh peer).
           */
          by?: string;
      }
    | { type: "failed"; detail: string }
    | { type: "dispose" };

export type RemoteSignalPayload = {
    kind: SignalKind;
    sdp?: string;
    candidate?: string;
    sdpMid?: string;
    sdpMLineIndex?: number;
};

export type RunCommand =
    | { type: "logIgnored"; event: RunEvent; reason: string }
    | { type: "runPipeline" }
    | { type: "beginSignaling"; sessionId: string }
    | { type: "resendOffer"; remoteAccount: string }
    | { type: "joinSession"; sessionId: string }
    | { type: "leaveSession"; sessionId: string; reason: string }
    | { type: "createPeer"; remoteAccount: string; sessionId: string }
    | { type: "disposePeer"; remoteAccount: string }
    | { type: "disposeAllPeers" }
    | { type: "applyRemoteSignal"; remoteAccount: string; signal: RemoteSignalPayload }
    | { type: "scheduleRecovery"; sessionId: string }
    | { type: "cancelRecovery" }
    | { type: "flushPending"; recipients: readonly string[] }
    | { type: "notifyDataChannelReady"; remoteAccount: string }
    | { type: "abortRun" };

export type TransitionResult = {
    state: RunMachineState;
    commands: readonly RunCommand[];
};

export function initialMachineState(): RunMachineState {
    return { tag: "idle" };
}

/**
 * Build the initial UI snapshot for a freshly-created SpaceRun. Callers
 * outside the state machine module MUST use this instead of constructing a
 * `{ phase: ... }` literal so phase changes flow through `deriveSnapshot`.
 *
 * Without a sessionId, the run starts in `idle` so the first `ensure`
 * event drives `idle → ensuring → runPipeline`. (Earlier versions
 * defaulted to `ensuring`, which silently ate the first `ensure` event
 * because the FSM's "ensure in progress" guard couldn't distinguish a
 * fresh run from an in-flight pipeline.)
 */
export function initialRunSnapshot(args: {
    spaceUuid: string;
    kind: RunKind;
    members: readonly string[];
    self: string;
    sessionId?: string;
}): ChatDataSessionSnapshot {
    const state: RunMachineState = args.sessionId
        ? { tag: "signaling", sessionId: args.sessionId, peerSlots: {} }
        : { tag: "idle" };
    const ctx: RunContext = {
        spaceUuid: args.spaceUuid,
        kind: args.kind,
        members: args.members,
        self: args.self,
        presence: {},
        livePeerReady: {},
        hasJoined: false,
        joinSessionRequested: false,
        hasActivePeer: {},
        peerNeedsReconnect: {},
    };
    return deriveSnapshot(state, ctx);
}

export function snapshotToMachineState(
    snapshot: ChatDataSessionSnapshot,
): RunMachineState {
    switch (snapshot.phase) {
        case "idle":
            return { tag: "idle" };
        case "ensuring":
            return { tag: "ensuring" };
        case "creating":
            return { tag: "creating" };
        case "waiting-peer":
            return snapshot.sessionId
                ? { tag: "waitingPeer", sessionId: snapshot.sessionId }
                : { tag: "idle" };
        case "joining":
            return snapshot.sessionId
                ? { tag: "joining", sessionId: snapshot.sessionId }
                : { tag: "idle" };
        case "signaling":
        case "ready":
            return snapshot.sessionId
                ? {
                      tag: snapshot.phase === "ready" ? "ready" : "signaling",
                      sessionId: snapshot.sessionId,
                      peerSlots: {},
                  }
                : { tag: "idle" };
        case "failed":
            return {
                tag: "failed",
                sessionId: snapshot.sessionId,
                lastError: snapshot.lastError ?? "failed",
            };
    }
}

function onlineRemotes(ctx: RunContext): string[] {
    return remoteMembers(ctx.members, ctx.self).filter(
        (member) => ctx.presence[member] === "online",
    );
}

/**
 * Group: ready iff every currently-online remote has its mesh peer open.
 * DM: ready iff the single peer's data channel is open (presence may have
 * flipped after open, e.g. peer briefly offline; we still want phase=ready).
 */
function allOnlineSlotsReady(
    ctx: RunContext,
    peerSlots: Record<string, PeerSlotState>,
): boolean {
    if (ctx.kind === "dm") {
        const peer = ctx.members.find((m) => m !== ctx.self);
        if (!peer) return false;
        return (
            peerSlots[peer] === "ready" || ctx.livePeerReady[peer] === true
        );
    }
    const online = onlineRemotes(ctx);
    if (online.length === 0) return false;
    return online.every(
        (member) =>
            peerSlots[member] === "ready" || ctx.livePeerReady[member] === true,
    );
}

function anyPeerReady(ctx: RunContext): boolean {
    return Object.values(ctx.livePeerReady).some(Boolean);
}

/** True when another group remote already has a live or in-flight mesh leg. */
function anyOtherGroupMeshLeg(
    ctx: RunContext,
    exceptParticipant: string,
): boolean {
    if (ctx.kind !== "group") return false;
    return remoteMembers(ctx.members, ctx.self).some(
        (member) =>
            member !== exceptParticipant &&
            (ctx.livePeerReady[member] === true ||
                ctx.hasActivePeer[member] === true),
    );
}

function meshPeerReadyMap(
    ctx: RunContext,
): Record<string, boolean> | undefined {
    if (ctx.kind !== "group") return undefined;
    const out: Record<string, boolean> = {};
    for (const remote of remoteMembers(ctx.members, ctx.self)) {
        out[remote] = ctx.livePeerReady[remote] === true;
    }
    return out;
}

/** Derive the authoritative UI snapshot from machine state + live peer readiness. */
export function deriveSnapshot(
    state: RunMachineState,
    ctx: RunContext,
): ChatDataSessionSnapshot {
    const meshPeerReady = meshPeerReadyMap(ctx);
    const dataChannelReady = anyPeerReady(ctx);

    switch (state.tag) {
        case "idle":
            return {
                spaceUuid: ctx.spaceUuid,
                phase: "idle",
                dataChannelReady: false,
                meshPeerReady,
            };
        case "ensuring":
            return {
                spaceUuid: ctx.spaceUuid,
                phase: "ensuring",
                dataChannelReady: false,
                meshPeerReady,
            };
        case "creating":
            return {
                spaceUuid: ctx.spaceUuid,
                phase: "creating",
                dataChannelReady: false,
                meshPeerReady,
            };
        case "waitingPeer":
            return {
                spaceUuid: ctx.spaceUuid,
                phase: "waiting-peer",
                sessionId: state.sessionId,
                dataChannelReady: false,
                meshPeerReady,
            };
        case "joining":
            return {
                spaceUuid: ctx.spaceUuid,
                phase: "joining",
                sessionId: state.sessionId,
                dataChannelReady,
                meshPeerReady,
            };
        case "signaling": {
            const phase: ChatDataSessionPhase =
                ctx.kind === "group" &&
                allOnlineSlotsReady(ctx, state.peerSlots) &&
                dataChannelReady
                    ? "ready"
                    : "signaling";
            return {
                spaceUuid: ctx.spaceUuid,
                phase,
                sessionId: state.sessionId,
                dataChannelReady,
                meshPeerReady,
            };
        }
        case "ready":
            return {
                spaceUuid: ctx.spaceUuid,
                phase: dataChannelReady ? "ready" : "signaling",
                sessionId: state.sessionId,
                dataChannelReady,
                meshPeerReady,
            };
        case "failed":
            return {
                spaceUuid: ctx.spaceUuid,
                phase: "failed",
                sessionId: state.sessionId,
                dataChannelReady: false,
                lastError: state.lastError,
                meshPeerReady,
            };
    }
}

function withSignaling(
    sessionId: string,
    ctx: RunContext,
    peerSlots: Record<string, PeerSlotState> = {},
): RunMachineState {
    for (const remote of onlineRemotes(ctx)) {
        if (!peerSlots[remote]) {
            peerSlots[remote] = ctx.livePeerReady[remote] ? "ready" : "connecting";
        }
    }
    return { tag: "signaling", sessionId, peerSlots };
}

function ignore(
    state: RunMachineState,
    event: RunEvent,
    reason: string,
): TransitionResult {
    return {
        state,
        commands: [{ type: "logIgnored", event, reason }],
    };
}

export function transition(
    state: RunMachineState,
    event: RunEvent,
    ctx: RunContext,
): TransitionResult {
    switch (event.type) {
        case "ensure": {
            if (state.tag === "ready" && anyPeerReady(ctx)) {
                return ignore(state, event, "already ready");
            }
            if (
                state.tag === "ensuring" ||
                state.tag === "creating" ||
                state.tag === "joining" ||
                state.tag === "waitingPeer"
            ) {
                const sessionId =
                    state.tag === "ensuring" || state.tag === "creating"
                        ? undefined
                        : state.sessionId;
                if (sessionId) {
                    return {
                        state,
                        commands: [{ type: "beginSignaling", sessionId }],
                    };
                }
                return ignore(state, event, "ensure in progress");
            }
            if (state.tag === "signaling") {
                return ignore(state, event, "ensure while signaling");
            }
            if (state.tag === "ready") {
                const sessionId = state.sessionId;
                return {
                    state,
                    commands: [{ type: "beginSignaling", sessionId }],
                };
            }
            if (state.tag === "failed") {
                return {
                    state: { tag: "ensuring" },
                    commands: [
                        { type: "abortRun" },
                        { type: "disposeAllPeers" },
                        { type: "runPipeline" },
                    ],
                };
            }
            return {
                state: { tag: "ensuring" },
                commands: [{ type: "runPipeline" }],
            };
        }

        case "pipelineCreating":
            if (state.tag === "ensuring" || state.tag === "idle") {
                return { state: { tag: "creating" }, commands: [] };
            }
            return ignore(state, event, "pipelineCreating unexpected");

        case "sessionResolved": {
            if (state.tag !== "creating" && state.tag !== "ensuring") {
                return ignore(state, event, "sessionResolved unexpected phase");
            }
            if (!event.anyPeerOnline) {
                // DM: join x-webrtcsig as soon as we have a session id so the
                // server roster includes us before the remote comes online.
                // Otherwise we only learn we are still "pending" via
                // participantJoined (live-socket fanout) and never receive
                // sessionSnapshot (joined-socket fanout) — offers stay deferred.
                const commands: RunCommand[] =
                    ctx.kind === "dm"
                        ? [
                              {
                                  type: "beginSignaling",
                                  sessionId: event.sessionId,
                              },
                          ]
                        : [];
                return {
                    state: { tag: "waitingPeer", sessionId: event.sessionId },
                    commands,
                };
            }
            return {
                state: withSignaling(event.sessionId, ctx),
                commands: [{ type: "beginSignaling", sessionId: event.sessionId }],
            };
        }

        case "sessionInvite": {
            if (
                state.tag !== "idle" &&
                "sessionId" in state &&
                state.sessionId &&
                state.sessionId !== event.sessionId
            ) {
                return ignore(state, event, "session id mismatch");
            }
            // Duplicate fan-out while the mesh is already up. Rejoin and
            // late joiners are handled by `participantJoined` / `rosterUpdated`;
            // re-running `beginSignaling` here caused beginSignaling storms
            // after app re-entry and WS reconnect.
            if (state.tag === "ready" && anyPeerReady(ctx)) {
                return ignore(
                    state,
                    event,
                    "duplicate sessionInvite while ready",
                );
            }
            if (
                ctx.kind === "dm" &&
                (ctx.hasJoined || ctx.joinSessionRequested)
            ) {
                const dmPeer = dmPeerAccount(ctx.members, ctx.self);
                if (
                    dmPeer &&
                    (state.tag === "signaling" || state.tag === "joining")
                ) {
                    return {
                        state,
                        commands: [
                            {
                                type: "resendOffer",
                                remoteAccount: dmPeer,
                            },
                        ],
                    };
                }
            }
            if (
                ctx.kind === "group" &&
                (state.tag === "signaling" || state.tag === "joining") &&
                ctx.hasActivePeer[event.from] &&
                !ctx.livePeerReady[event.from]
            ) {
                return {
                    state,
                    commands: [
                        {
                            type: "resendOffer",
                            remoteAccount: event.from,
                        },
                    ],
                };
            }
            return {
                state: withSignaling(event.sessionId, ctx),
                commands: [{ type: "beginSignaling", sessionId: event.sessionId }],
            };
        }

        case "participantJoined": {
            if (
                state.tag !== "idle" &&
                "sessionId" in state &&
                state.sessionId &&
                state.sessionId !== event.sessionId
            ) {
                return ignore(state, event, "cross-session participantJoined");
            }

            if (
                ctx.kind === "dm" &&
                (ctx.hasJoined || ctx.joinSessionRequested)
            ) {
                const dmPeer = dmPeerAccount(ctx.members, ctx.self);
                if (dmPeer && event.participant === dmPeer) {
                    if (
                        (state.tag === "signaling" ||
                            state.tag === "joining" ||
                            state.tag === "waitingPeer") &&
                        !ctx.livePeerReady[dmPeer] &&
                        (ctx.peerNeedsReconnect[dmPeer] ||
                            (ctx.hasActivePeer[dmPeer] && !ctx.hasJoined))
                    ) {
                        return {
                            state: withSignaling(event.sessionId, ctx),
                            commands: [
                                { type: "disposeAllPeers" },
                                {
                                    type: "beginSignaling",
                                    sessionId: event.sessionId,
                                },
                            ],
                        };
                    }
                    if (
                        state.tag === "signaling" ||
                        state.tag === "joining"
                    ) {
                        return {
                            state,
                            commands: [
                                {
                                    type: "resendOffer",
                                    remoteAccount: event.participant,
                                },
                            ],
                        };
                    }
                }
            }

            if (
                ctx.kind === "group" &&
                state.tag === "ready" &&
                ctx.livePeerReady[event.participant]
            ) {
                return ignore(
                    state,
                    event,
                    "participantJoined while mesh peer already ready",
                );
            }

            const next = withSignaling(event.sessionId, ctx);
            const commands: RunCommand[] = [
                { type: "beginSignaling", sessionId: event.sessionId },
            ];
            if (
                ctx.kind === "group" &&
                !ctx.livePeerReady[event.participant]
            ) {
                commands.push({
                    type: "resendOffer",
                    remoteAccount: event.participant,
                });
            }
            if (state.tag === "ready") {
                const disposeAll =
                    ctx.kind === "dm" ||
                    !anyOtherGroupMeshLeg(ctx, event.participant);
                if (disposeAll) {
                    commands.unshift({ type: "disposeAllPeers" });
                }
            }
            return { state: next, commands };
        }

        case "rosterUpdated": {
            // F1: roster is informational at the FSM level — the orchestrator
            // updates `run.sessionRoster` outside the FSM, and the joined
            // set drives F2's initiation rule when the reconciler creates a
            // peer. We still want roster deltas to nudge signaling when
            // there's a new joiner the FSM hasn't seen yet (e.g. group case
            // where `participantJoined` arrived for a peer who only became
            // visible to us via the snapshot after our local presence map
            // was stale). Treat the joined set as a hint to (re-)reconcile.
            if (
                state.tag !== "idle" &&
                "sessionId" in state &&
                state.sessionId &&
                state.sessionId !== event.sessionId
            ) {
                return ignore(state, event, "rosterUpdated session mismatch");
            }
            if (
                state.tag === "signaling" ||
                state.tag === "ready" ||
                state.tag === "waitingPeer" ||
                state.tag === "joining"
            ) {
                if (event.newJoiners.length === 0) {
                    return ignore(
                        state,
                        event,
                        "rosterUpdated no new joiners",
                    );
                }
                if (ctx.kind === "dm" && state.tag === "signaling") {
                    const dmPeer = dmPeerAccount(ctx.members, ctx.self);
                    if (dmPeer && event.newJoiners.includes(dmPeer)) {
                        return {
                            state,
                            commands: [
                                {
                                    type: "resendOffer",
                                    remoteAccount: dmPeer,
                                },
                            ],
                        };
                    }
                    return ignore(
                        state,
                        event,
                        "rosterUpdated DM during signaling (roster only)",
                    );
                }
                if (ctx.kind === "group" && state.tag === "signaling") {
                    const commands: RunCommand[] = [];
                    let needBegin = false;
                    for (const joiner of event.newJoiners) {
                        if (ctx.livePeerReady[joiner]) continue;
                        if (ctx.hasActivePeer[joiner]) {
                            commands.push({
                                type: "resendOffer",
                                remoteAccount: joiner,
                            });
                        } else {
                            needBegin = true;
                        }
                    }
                    if (needBegin) {
                        commands.push({
                            type: "beginSignaling",
                            sessionId: event.sessionId,
                        });
                    }
                    if (commands.length > 0) {
                        return { state, commands };
                    }
                    return ignore(
                        state,
                        event,
                        "rosterUpdated group during signaling (noop)",
                    );
                }
                return {
                    state,
                    commands: [
                        {
                            type: "beginSignaling",
                            sessionId: event.sessionId,
                        },
                    ],
                };
            }
            return ignore(state, event, "rosterUpdated noop");
        }

        case "transportLost": {
            // F1: per-peer recoverable transport drop. Identical to
            // `peerLost` at the FSM level (dispose just that peer, keep
            // the run alive, schedule recovery so renegotiation kicks in
            // once the peer rejoins). Distinct from `sessionEnded` so the
            // run never transitions to `failed` for this reason.
            if (
                state.tag !== "idle" &&
                "sessionId" in state &&
                state.sessionId &&
                state.sessionId !== event.sessionId
            ) {
                return ignore(state, event, "transportLost session mismatch");
            }
            const sessionId =
                state.tag === "signaling" ||
                state.tag === "ready" ||
                state.tag === "joining" ||
                state.tag === "waitingPeer"
                    ? state.sessionId
                    : undefined;
            if (!sessionId) {
                return ignore(state, event, "transportLost without session");
            }
            const baseSlots: Record<string, PeerSlotState> =
                state.tag === "signaling" || state.tag === "ready"
                    ? { ...state.peerSlots }
                    : {};
            baseSlots[event.participant] = "absent";
            return {
                state: withSignaling(sessionId, ctx, baseSlots),
                commands: [
                    { type: "disposePeer", remoteAccount: event.participant },
                    { type: "scheduleRecovery", sessionId },
                ],
            };
        }

        case "beginSignaling": {
            if (state.tag === "idle" || state.tag === "failed") {
                return ignore(state, event, "beginSignaling without active run");
            }
            if (state.tag === "ensuring" || state.tag === "creating") {
                // Pipeline is still resolving the session; the
                // sessionResolved event will trigger beginSignaling.
                return ignore(state, event, "beginSignaling before session resolved");
            }
            const sessionChanged =
                (state.tag === "signaling" ||
                    state.tag === "ready" ||
                    state.tag === "waitingPeer" ||
                    state.tag === "joining") &&
                state.sessionId !== event.sessionId;
            const commands: RunCommand[] = [
                { type: "beginSignaling", sessionId: event.sessionId },
            ];
            if (
                sessionChanged &&
                (state.tag === "signaling" || state.tag === "ready")
            ) {
                commands.unshift({ type: "disposeAllPeers" });
            }
            const peerSlots =
                state.tag === "signaling" || state.tag === "ready"
                    ? sessionChanged
                        ? {}
                        : { ...state.peerSlots }
                    : {};
            return {
                state: withSignaling(event.sessionId, ctx, peerSlots),
                commands,
            };
        }

        case "signalingDeferred":
            return {
                state: { tag: "waitingPeer", sessionId: event.sessionId },
                commands: [],
            };

        case "peerOpened": {
            const sessionId =
                state.tag === "signaling" || state.tag === "ready"
                    ? state.sessionId
                    : state.tag === "joining" || state.tag === "waitingPeer"
                      ? state.sessionId
                      : undefined;
            if (!sessionId) {
                return ignore(state, event, "peerOpened without session");
            }
            // Reseed slots from online remotes when transitioning out of a
            // non-mesh state so we don't lose track of remotes who joined
            // before this peer opened.
            const baseSlots: Record<string, PeerSlotState> =
                state.tag === "signaling" || state.tag === "ready"
                    ? { ...state.peerSlots }
                    : {};
            for (const remote of onlineRemotes(ctx)) {
                if (!baseSlots[remote]) {
                    baseSlots[remote] = ctx.livePeerReady[remote]
                        ? "ready"
                        : "connecting";
                }
            }
            baseSlots[event.remoteAccount] = "ready";

            const ready = allOnlineSlotsReady(ctx, baseSlots);
            const nextState: RunMachineState = ready
                ? { tag: "ready", sessionId, peerSlots: baseSlots }
                : { tag: "signaling", sessionId, peerSlots: baseSlots };

            return {
                state: nextState,
                commands: [
                    { type: "cancelRecovery" },
                    {
                        type: "notifyDataChannelReady",
                        remoteAccount: event.remoteAccount,
                    },
                    { type: "flushPending", recipients: [event.remoteAccount] },
                ],
            };
        }

        case "peerLost": {
            const sessionId =
                state.tag === "signaling" ||
                state.tag === "ready" ||
                state.tag === "joining" ||
                state.tag === "waitingPeer"
                    ? state.sessionId
                    : undefined;
            if (!sessionId) {
                return ignore(state, event, "peerLost without session");
            }
            const baseSlots: Record<string, PeerSlotState> =
                state.tag === "signaling" || state.tag === "ready"
                    ? { ...state.peerSlots }
                    : {};
            baseSlots[event.remoteAccount] = "absent";
            return {
                state: withSignaling(sessionId, ctx, baseSlots),
                commands: [
                    { type: "disposePeer", remoteAccount: event.remoteAccount },
                    { type: "scheduleRecovery", sessionId },
                ],
            };
        }

        case "transportTornDown": {
            const sessionId =
                event.sessionId ??
                (state.tag !== "idle" &&
                state.tag !== "ensuring" &&
                state.tag !== "creating" &&
                state.tag !== "failed"
                    ? state.sessionId
                    : undefined);
            if (!sessionId) {
                return {
                    state,
                    commands: [{ type: "disposeAllPeers" }],
                };
            }
            return {
                // Reseed slots from current presence so the next render shows
                // the right meshPeerReady map instead of an empty one.
                state: withSignaling(sessionId, ctx, {}),
                commands: [
                    { type: "cancelRecovery" },
                    { type: "disposeAllPeers" },
                ],
            };
        }

        case "presenceOnline": {
            if (!ctx.members.includes(event.account)) {
                return ignore(state, event, "presence for non-member");
            }
            const sessionId =
                state.tag === "waitingPeer" ||
                state.tag === "joining" ||
                state.tag === "signaling" ||
                state.tag === "ready"
                    ? state.sessionId
                    : undefined;
            if (!sessionId) {
                return ignore(state, event, "presenceOnline without session");
            }
            if (
                ctx.kind === "dm" &&
                (state.tag === "ready" || state.tag === "signaling") &&
                !ctx.hasActivePeer[event.account] &&
                ctx.presence[event.account] === "online"
            ) {
                return {
                    state:
                        state.tag === "ready" || state.tag === "signaling"
                            ? {
                                  tag: "signaling",
                                  sessionId,
                                  peerSlots: {},
                              }
                            : state,
                    commands: [
                        { type: "disposeAllPeers" },
                        { type: "beginSignaling", sessionId },
                    ],
                };
            }
            if (
                ctx.kind === "dm" &&
                (state.tag === "signaling" ||
                    state.tag === "joining" ||
                    state.tag === "waitingPeer") &&
                ctx.hasJoined &&
                ctx.hasActivePeer[event.account] &&
                !ctx.livePeerReady[event.account] &&
                ctx.peerNeedsReconnect[event.account]
            ) {
                return {
                    state:
                        state.tag === "waitingPeer"
                            ? {
                                  tag: "signaling",
                                  sessionId,
                                  peerSlots: {},
                              }
                            : state,
                    commands: [
                        { type: "disposeAllPeers" },
                        { type: "beginSignaling", sessionId },
                    ],
                };
            }
            if (
                ctx.kind === "dm" &&
                (state.tag === "signaling" || state.tag === "joining") &&
                ctx.hasJoined &&
                ctx.hasActivePeer[event.account] &&
                !ctx.livePeerReady[event.account]
            ) {
                return {
                    state,
                    commands: [
                        {
                            type: "resendOffer",
                            remoteAccount: event.account,
                        },
                    ],
                };
            }
            if (
                ctx.livePeerReady[event.account] &&
                state.tag === "ready"
            ) {
                return ignore(state, event, "already ready");
            }
            return {
                state,
                commands: [{ type: "beginSignaling", sessionId }],
            };
        }

        case "presenceOffline": {
            if (!ctx.members.includes(event.account)) {
                return ignore(state, event, "presence for non-member");
            }
            if (ctx.kind === "group") {
                const sessionId =
                    state.tag === "signaling" || state.tag === "ready"
                        ? state.sessionId
                        : undefined;
                if (!sessionId) {
                    return ignore(state, event, "presenceOffline without session");
                }
                const peerSlots: Record<string, PeerSlotState> =
                    state.tag === "signaling" || state.tag === "ready"
                        ? { ...state.peerSlots, [event.account]: "absent" }
                        : {};
                return {
                    state: { tag: "signaling", sessionId, peerSlots },
                    commands: [
                        { type: "disposePeer", remoteAccount: event.account },
                    ],
                };
            }
            const sessionId =
                state.tag === "signaling" ||
                state.tag === "ready" ||
                state.tag === "waitingPeer"
                    ? state.sessionId
                    : undefined;
            if (!sessionId) {
                return ignore(state, event, "presenceOffline without session");
            }
            return {
                state: { tag: "waitingPeer", sessionId },
                commands: [
                    { type: "disposeAllPeers" },
                ],
            };
        }

        case "recoveryTick": {
            if (
                state.tag !== "signaling" &&
                state.tag !== "waitingPeer" &&
                state.tag !== "ready"
            ) {
                return ignore(state, event, "recoveryTick unexpected phase");
            }
            const sessionId = state.sessionId;
            if (!sessionId || sessionId !== event.sessionId) {
                return ignore(state, event, "recoveryTick session mismatch");
            }
            return {
                state,
                commands: [{ type: "beginSignaling", sessionId }],
            };
        }

        case "sessionEnded": {
            // For group meshes, a `sessionEnded` frame whose `by` is another
            // participant just means that participant's tab disposed (they
            // called `leaveSession`). The mesh among the remaining
            // participants is still valid; we should only dispose the
            // leaver's mesh peer and let presence-online drive their return.
            // Without this branch, one participant disposing kills the
            // entire group session for everyone (e.g. their second mesh
            // peer's data channel closes, transport recovery scheduled in a
            // tight loop, subsequent sends report `group mesh peer not
            // ready`).
            if (
                ctx.kind === "group" &&
                event.by &&
                event.by !== ctx.self &&
                ctx.members.includes(event.by) &&
                (state.tag === "signaling" || state.tag === "ready") &&
                state.sessionId === event.sessionId
            ) {
                const peerSlots: Record<string, PeerSlotState> = {
                    ...state.peerSlots,
                    [event.by]: "absent",
                };
                return {
                    state: { tag: "signaling", sessionId: state.sessionId, peerSlots },
                    commands: [
                        { type: "disposePeer", remoteAccount: event.by },
                    ],
                };
            }
            const sessionId = event.sessionId;
            return {
                state: { tag: "failed", sessionId, lastError: event.reason },
                commands: [
                    { type: "cancelRecovery" },
                    { type: "disposeAllPeers" },
                ],
            };
        }

        case "failed": {
            const sessionId =
                state.tag !== "idle" &&
                state.tag !== "ensuring" &&
                state.tag !== "creating"
                    ? state.sessionId
                    : undefined;
            return {
                state: { tag: "failed", sessionId, lastError: event.detail },
                commands: [
                    { type: "cancelRecovery" },
                    { type: "disposeAllPeers" },
                ],
            };
        }

        case "remoteSignal":
            return {
                state,
                commands: [
                    {
                        type: "applyRemoteSignal",
                        remoteAccount: event.from,
                        signal: {
                            kind: event.kind,
                            sdp: event.sdp,
                            candidate: event.candidate,
                            sdpMid: event.sdpMid,
                            sdpMLineIndex: event.sdpMLineIndex,
                        },
                    },
                ],
            };

        case "dispose":
            return {
                state: { tag: "idle" },
                commands: [
                    { type: "cancelRecovery" },
                    { type: "disposeAllPeers" },
                    ...(state.tag !== "idle" &&
                    state.tag !== "failed" &&
                    state.tag !== "ensuring" &&
                    state.tag !== "creating" &&
                    ctx.hasJoined &&
                    "sessionId" in state &&
                    state.sessionId
                        ? [
                              {
                                  type: "leaveSession" as const,
                                  sessionId: state.sessionId,
                                  reason: "client-disposed",
                              },
                          ]
                        : []),
                ],
            };

        default:
            return ignore(state, event, "unknown event");
    }
}

