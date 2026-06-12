import {
    remoteMembers,
    type AvCallSessionPhase,
    type AvCallSessionSnapshot,
} from "./av-call-session-types";
import type { SignalKind } from "./webrtc-signaling-client";

/**
 * Per-remote media leg in the Meet Call FSM (v2b: `mediaLegs`). Tracks media
 * connection state, not the underlying SharedMeetPeer / PC object.
 */
export type AvPeerSlotState = "absent" | "connecting" | "ready";

/** Remotes whose voluntary departure has already been processed (dedupe). */
export type AvDepartedPeers = Readonly<Record<string, true>>;

export type AvRunMachineState =
    | { tag: "idle" }
    | { tag: "ensuring" }
    | { tag: "creating" }
    | { tag: "waitingPeer"; sessionId: string }
    | { tag: "joining"; sessionId: string }
    | {
          tag: "signaling";
          sessionId: string;
          peerSlots: Record<string, AvPeerSlotState>;
          /** True after joinSession + commitAvCallJoin succeeded. */
          signalingJoined: boolean;
          departedPeers?: AvDepartedPeers;
      }
    | {
          tag: "ready";
          sessionId: string;
          peerSlots: Record<string, AvPeerSlotState>;
          signalingJoined: boolean;
          departedPeers?: AvDepartedPeers;
      }
    | {
          tag: "pendingInvite";
          sessionId: string;
          from: string;
          wantVideo: boolean;
          wantAudio: boolean;
      }
    | { tag: "failed"; sessionId?: string; lastError: string };

export type AvRunKind = "dm" | "group";

export type AvRunContext = {
    spaceUuid: string;
    kind: AvRunKind;
    members: readonly string[];
    self: string;
    presence: Readonly<Record<string, string>>;
    /** Live media-connected status from MeetWebRtcPeer objects. */
    liveMediaReady: Readonly<Record<string, boolean>>;
    /** Whether a live MeetWebRtcPeer object exists for the remote account. */
    hasActivePeer: Readonly<Record<string, boolean>>;
    hasJoined: boolean;
    hasLocalStream: boolean;
};

export type AvRunEvent =
    | { type: "ensure" }
    | { type: "pipelineCreating" }
    | { type: "sessionResolved"; sessionId: string; anyPeerOnline: boolean }
    | {
          type: "sessionInvite";
          sessionId: string;
          from: string;
          wantVideo: boolean;
          wantAudio: boolean;
      }
    | { type: "acceptInvite" }
    | { type: "declineInvite"; reason: "user" | "timeout" }
    | { type: "discoveredActiveInvite"; sessionId: string; from: string }
    | { type: "participantJoined"; sessionId: string; participant: string }
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
    | { type: "joinedSignaling"; sessionId: string }
    | { type: "localMediaReady"; sessionId: string }
    | { type: "mediaConnected"; remoteAccount: string }
    | { type: "mediaLost"; remoteAccount: string; detail: string }
    | { type: "transportTornDown"; reason: string; sessionId?: string }
    | { type: "presenceOnline"; account: string }
    | { type: "presenceOffline"; account: string }
    | { type: "recoveryTick"; sessionId: string }
    | { type: "sessionEnded"; sessionId: string; reason: string; by?: string }
    | { type: "failed"; detail: string }
    | { type: "hangup"; reason: string }
    | { type: "dispose" };

export type AvRemoteSignalPayload = {
    kind: SignalKind;
    sdp?: string;
    candidate?: string;
    sdpMid?: string;
    sdpMLineIndex?: number;
};

export type AvRunCommand =
    | { type: "logIgnored"; event: AvRunEvent; reason: string }
    | { type: "runPipeline" }
    | { type: "beginSignaling"; sessionId: string }
    | { type: "resendOffer"; remoteAccount: string }
    | { type: "joinSession"; sessionId: string }
    | { type: "leaveSession"; sessionId: string; reason: string }
    | { type: "createPeer"; remoteAccount: string; sessionId: string }
    | { type: "disposePeer"; remoteAccount: string }
    | { type: "disposeAllPeers" }
    | { type: "acquireLocalMedia" }
    | { type: "releaseLocalMedia" }
    | {
          type: "applyRemoteSignal";
          remoteAccount: string;
          signal: AvRemoteSignalPayload;
      }
    | { type: "scheduleRecovery"; sessionId: string }
    | { type: "cancelRecovery" }
    | { type: "notifyMediaReady"; remoteAccount: string }
    | { type: "commitTimelineEvent"; sessionId: string; reason: string }
    | { type: "commitParticipantLeft"; sessionId: string; reason: string }
    | { type: "commitSessionEnded"; sessionId: string; reason: string }
    | { type: "commitSessionFailed"; sessionId: string; reason: string }
    | {
          type: "notifyPendingInvite";
          sessionId: string;
          from: string;
          wantVideo: boolean;
          wantAudio: boolean;
      }
    | { type: "clearPendingInvite"; sessionId: string }
    | { type: "abortRun" };

export type AvTransitionResult = {
    state: AvRunMachineState;
    commands: readonly AvRunCommand[];
};

export function initialAvRunMachineState(): AvRunMachineState {
    return { tag: "idle" };
}

/**
 * Build the initial UI snapshot for a freshly-created AvCallSpaceRun. Callers
 * outside the state machine module MUST use this instead of constructing a
 * `{ phase: ... }` literal so phase changes flow through `deriveAvSnapshot`.
 */
export function initialAvCallRunSnapshot(args: {
    spaceUuid: string;
    kind: AvRunKind;
    members: readonly string[];
    self: string;
    sessionId?: string;
    /** When set, build a `pendingInvite` snapshot (incoming invite, not yet accepted). */
    incomingInvite?: { from: string; wantVideo: boolean; wantAudio: boolean };
}): AvCallSessionSnapshot {
    let state: AvRunMachineState;
    if (args.incomingInvite && args.sessionId) {
        state = {
            tag: "pendingInvite",
            sessionId: args.sessionId,
            from: args.incomingInvite.from,
            wantVideo: args.incomingInvite.wantVideo,
            wantAudio: args.incomingInvite.wantAudio,
        };
    } else if (args.sessionId) {
        state = { tag: "waitingPeer", sessionId: args.sessionId };
    } else {
        state = { tag: "ensuring" };
    }
    const ctx: AvRunContext = {
        spaceUuid: args.spaceUuid,
        kind: args.kind,
        members: args.members,
        self: args.self,
        presence: {},
        liveMediaReady: {},
        hasActivePeer: {},
        hasJoined: false,
        hasLocalStream: false,
    };
    return deriveAvSnapshot(state, ctx);
}

export function avSnapshotToMachineState(
    snapshot: AvCallSessionSnapshot,
): AvRunMachineState {
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
                      signalingJoined: snapshot.signalingJoined,
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

function onlineRemotes(ctx: AvRunContext): string[] {
    return remoteMembers(ctx.members, ctx.self).filter(
        (member) => ctx.presence[member] === "online",
    );
}

/**
 * Group: ready iff every currently-online remote has its mesh peer media-connected.
 * DM: ready iff the single peer has media connected.
 */
function allOnlineSlotsReady(
    ctx: AvRunContext,
    peerSlots: Record<string, AvPeerSlotState>,
): boolean {
    if (ctx.kind === "dm") {
        const peer = ctx.members.find((m) => m !== ctx.self);
        if (!peer) return false;
        return (
            peerSlots[peer] === "ready" || ctx.liveMediaReady[peer] === true
        );
    }
    const online = onlineRemotes(ctx);
    if (online.length === 0) return false;
    return online.every(
        (member) =>
            peerSlots[member] === "ready" ||
            ctx.liveMediaReady[member] === true,
    );
}

function anyPeerMediaReady(ctx: AvRunContext): boolean {
    return Object.values(ctx.liveMediaReady).some(Boolean);
}

/**
 * Live readiness check for the "ready" snapshot derivation. Unlike
 * `allOnlineSlotsReady` (which falls back to recorded slot state), this only
 * trusts the live peer-object state — so a stale `ready` machine state with
 * dropped media falls back to "signaling" until live state agrees.
 */
function liveOnlineMediaReady(ctx: AvRunContext): boolean {
    if (ctx.kind === "dm") {
        const peer = ctx.members.find((m) => m !== ctx.self);
        if (!peer) return false;
        return ctx.liveMediaReady[peer] === true;
    }
    const online = onlineRemotes(ctx);
    if (online.length === 0) return false;
    return online.every((member) => ctx.liveMediaReady[member] === true);
}

function meshPeerSignalingReadyMap(
    ctx: AvRunContext,
): Record<string, boolean> | undefined {
    if (ctx.kind !== "group") return undefined;
    const out: Record<string, boolean> = {};
    for (const remote of remoteMembers(ctx.members, ctx.self)) {
        out[remote] = ctx.liveMediaReady[remote] === true;
    }
    return out;
}

/** Derive the authoritative UI snapshot from machine state + live peer readiness. */
export function deriveAvSnapshot(
    state: AvRunMachineState,
    ctx: AvRunContext,
): AvCallSessionSnapshot {
    const meshPeerSignalingReady = meshPeerSignalingReadyMap(ctx);
    const mediaConnected =
        ctx.kind === "dm" ? anyPeerMediaReady(ctx) : undefined;

    switch (state.tag) {
        case "idle":
            return {
                spaceUuid: ctx.spaceUuid,
                phase: "idle",
                signalingJoined: false,
                mediaConnected: ctx.kind === "dm" ? false : undefined,
                meshPeerSignalingReady,
            };
        case "ensuring":
            return {
                spaceUuid: ctx.spaceUuid,
                phase: "ensuring",
                signalingJoined: false,
                mediaConnected: ctx.kind === "dm" ? false : undefined,
                meshPeerSignalingReady,
            };
        case "creating":
            return {
                spaceUuid: ctx.spaceUuid,
                phase: "creating",
                signalingJoined: false,
                mediaConnected: ctx.kind === "dm" ? false : undefined,
                meshPeerSignalingReady,
            };
        case "waitingPeer":
            return {
                spaceUuid: ctx.spaceUuid,
                phase: "waiting-peer",
                sessionId: state.sessionId,
                signalingJoined: false,
                mediaConnected: ctx.kind === "dm" ? false : undefined,
                meshPeerSignalingReady,
            };
        case "joining":
            return {
                spaceUuid: ctx.spaceUuid,
                phase: "joining",
                sessionId: state.sessionId,
                signalingJoined: ctx.hasJoined,
                mediaConnected,
                meshPeerSignalingReady,
            };
        case "pendingInvite":
            return {
                spaceUuid: ctx.spaceUuid,
                phase: "waiting-peer",
                sessionId: state.sessionId,
                signalingJoined: false,
                mediaConnected: ctx.kind === "dm" ? false : undefined,
                meshPeerSignalingReady,
            };
        case "signaling": {
            const phase: AvCallSessionPhase =
                state.signalingJoined &&
                allOnlineSlotsReady(ctx, state.peerSlots) &&
                liveOnlineMediaReady(ctx)
                    ? "ready"
                    : "signaling";
            return {
                spaceUuid: ctx.spaceUuid,
                phase,
                sessionId: state.sessionId,
                signalingJoined: state.signalingJoined,
                mediaConnected,
                meshPeerSignalingReady,
            };
        }
        case "ready":
            return {
                spaceUuid: ctx.spaceUuid,
                phase: liveOnlineMediaReady(ctx) ? "ready" : "signaling",
                sessionId: state.sessionId,
                signalingJoined: state.signalingJoined,
                mediaConnected,
                meshPeerSignalingReady,
            };
        case "failed":
            return {
                spaceUuid: ctx.spaceUuid,
                phase: "failed",
                sessionId: state.sessionId,
                signalingJoined: false,
                mediaConnected: ctx.kind === "dm" ? false : undefined,
                lastError: state.lastError,
                meshPeerSignalingReady:
                    ctx.kind === "group" ? {} : undefined,
            };
    }
}

function withSignaling(
    sessionId: string,
    ctx: AvRunContext,
    peerSlots: Record<string, AvPeerSlotState> = {},
    signalingJoined: boolean = ctx.hasJoined,
): AvRunMachineState {
    for (const remote of onlineRemotes(ctx)) {
        if (!peerSlots[remote]) {
            peerSlots[remote] = ctx.liveMediaReady[remote]
                ? "ready"
                : "connecting";
        }
    }
    return { tag: "signaling", sessionId, peerSlots, signalingJoined };
}

function ignore(
    state: AvRunMachineState,
    event: AvRunEvent,
    reason: string,
): AvTransitionResult {
    return {
        state,
        commands: [{ type: "logIgnored", event, reason }],
    };
}

function currentSessionId(state: AvRunMachineState): string | undefined {
    if (
        state.tag === "waitingPeer" ||
        state.tag === "joining" ||
        state.tag === "signaling" ||
        state.tag === "ready" ||
        state.tag === "pendingInvite"
    ) {
        return state.sessionId;
    }
    if (state.tag === "failed") return state.sessionId;
    return undefined;
}

function isGroupRemoteVoluntaryDeparture(
    ctx: AvRunContext,
    by: string | undefined,
): boolean {
    return (
        ctx.kind === "group" &&
        !!by &&
        by !== ctx.self &&
        ctx.members.includes(by)
    );
}

function markDeparted(
    departedPeers: AvDepartedPeers | undefined,
    account: string,
): AvDepartedPeers {
    return { ...departedPeers, [account]: true };
}

function isAlreadyDeparted(
    state: AvRunMachineState,
    account: string,
): boolean {
    if (state.tag !== "signaling" && state.tag !== "ready") {
        return false;
    }
    return state.departedPeers?.[account] === true;
}

function fullTeardownCommands(
    sessionId: string | undefined,
    reason: string,
    opts: {
        hasJoined: boolean;
        timeline?:
            | "commitSessionEnded"
            | "commitSessionFailed"
            | "commitTimelineEvent";
    },
): AvRunCommand[] {
    const commands: AvRunCommand[] = [
        { type: "cancelRecovery" },
        { type: "disposeAllPeers" },
        { type: "releaseLocalMedia" },
    ];
    if (sessionId && opts.hasJoined && opts.timeline) {
        commands.push({
            type: "leaveSession",
            sessionId,
            reason,
        });
        commands.push({
            type: opts.timeline,
            sessionId,
            reason,
        });
    }
    return commands;
}

function handleGroupRemoteDeparture(
    state: Extract<AvRunMachineState, { tag: "signaling" | "ready" }>,
    remote: string,
    reason: string,
): AvTransitionResult {
    if (isAlreadyDeparted(state, remote)) {
        return ignore(
            state,
            { type: "sessionEnded", sessionId: state.sessionId, reason, by: remote },
            "duplicate remote departure",
        );
    }
    const peerSlots = { ...state.peerSlots, [remote]: "absent" as const };
    const departedPeers = markDeparted(state.departedPeers, remote);
    return {
        state: {
            tag: "signaling",
            sessionId: state.sessionId,
            peerSlots,
            signalingJoined: state.signalingJoined,
            departedPeers,
        },
        commands: [{ type: "disposePeer", remoteAccount: remote }],
    };
}

export function avTransition(
    state: AvRunMachineState,
    event: AvRunEvent,
    ctx: AvRunContext,
): AvTransitionResult {
    switch (event.type) {
        case "ensure": {
            if (state.tag === "pendingInvite") {
                return ignore(state, event, "ensure while pending invite");
            }
            if (state.tag === "ready" && anyPeerMediaReady(ctx)) {
                return ignore(state, event, "already ready");
            }
            if (
                state.tag === "ensuring" ||
                state.tag === "creating" ||
                state.tag === "joining" ||
                state.tag === "signaling" ||
                state.tag === "waitingPeer"
            ) {
                const sessionId = currentSessionId(state);
                if (sessionId) {
                    return {
                        state,
                        commands: [{ type: "beginSignaling", sessionId }],
                    };
                }
                if (state.tag === "ensuring") {
                    return { state, commands: [{ type: "runPipeline" }] };
                }
                return ignore(state, event, "ensure in progress");
            }
            if (state.tag === "ready") {
                return {
                    state,
                    commands: [
                        { type: "beginSignaling", sessionId: state.sessionId },
                    ],
                };
            }
            if (state.tag === "failed") {
                return {
                    state: { tag: "ensuring" },
                    commands: [
                        { type: "abortRun" },
                        { type: "disposeAllPeers" },
                        { type: "releaseLocalMedia" },
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
                return {
                    state: { tag: "waitingPeer", sessionId: event.sessionId },
                    commands: [],
                };
            }
            return {
                state: withSignaling(event.sessionId, ctx, {}, false),
                commands: [
                    { type: "beginSignaling", sessionId: event.sessionId },
                ],
            };
        }

        case "sessionInvite": {
            // Server pushes an invite. Stash as pendingInvite so the UI can
            // show accept/decline; do NOT auto-join.
            const existingSessionId = currentSessionId(state);
            if (
                existingSessionId &&
                existingSessionId !== event.sessionId &&
                state.tag !== "idle" &&
                state.tag !== "failed"
            ) {
                return ignore(state, event, "session id mismatch on invite");
            }
            // If we're already joined (e.g. accepted then re-received), ignore.
            if (
                (state.tag === "signaling" || state.tag === "ready") &&
                state.signalingJoined
            ) {
                return ignore(state, event, "invite while joined");
            }
            return {
                state: {
                    tag: "pendingInvite",
                    sessionId: event.sessionId,
                    from: event.from,
                    wantVideo: event.wantVideo,
                    wantAudio: event.wantAudio,
                },
                commands: [
                    {
                        type: "notifyPendingInvite",
                        sessionId: event.sessionId,
                        from: event.from,
                        wantVideo: event.wantVideo,
                        wantAudio: event.wantAudio,
                    },
                ],
            };
        }

        case "discoveredActiveInvite": {
            // Same as sessionInvite but synthesized from objective state
            // (M5 path for offline users discovering an active group call).
            const existingSessionId = currentSessionId(state);
            if (
                existingSessionId &&
                existingSessionId !== event.sessionId &&
                state.tag !== "idle" &&
                state.tag !== "failed"
            ) {
                return ignore(state, event, "session id mismatch on discovered invite");
            }
            if (
                (state.tag === "signaling" || state.tag === "ready") &&
                state.signalingJoined
            ) {
                return ignore(state, event, "discovered invite while joined");
            }
            return {
                state: {
                    tag: "pendingInvite",
                    sessionId: event.sessionId,
                    from: event.from,
                    wantVideo: true,
                    wantAudio: true,
                },
                commands: [
                    {
                        type: "notifyPendingInvite",
                        sessionId: event.sessionId,
                        from: event.from,
                        wantVideo: true,
                        wantAudio: true,
                    },
                ],
            };
        }

        case "acceptInvite": {
            if (state.tag !== "pendingInvite") {
                return ignore(state, event, "accept without pending invite");
            }
            const sessionId = state.sessionId;
            return {
                state: withSignaling(sessionId, ctx, {}, false),
                commands: [
                    { type: "clearPendingInvite", sessionId },
                    { type: "beginSignaling", sessionId },
                ],
            };
        }

        case "declineInvite": {
            if (state.tag !== "pendingInvite") {
                return ignore(state, event, "decline without pending invite");
            }
            const sessionId = state.sessionId;
            const reason =
                event.reason === "timeout" ? "timeout" : "declined";
            return {
                state: { tag: "failed", sessionId, lastError: reason },
                commands: [
                    { type: "clearPendingInvite", sessionId },
                    { type: "joinSession", sessionId },
                    { type: "leaveSession", sessionId, reason },
                    { type: "commitTimelineEvent", sessionId, reason },
                    { type: "disposeAllPeers" },
                    { type: "releaseLocalMedia" },
                ],
            };
        }

        case "participantJoined": {
            const existingSessionId = currentSessionId(state);
            if (
                existingSessionId &&
                existingSessionId !== event.sessionId &&
                state.tag !== "idle"
            ) {
                return ignore(state, event, "cross-session participantJoined");
            }
            if (state.tag === "pendingInvite") {
                return ignore(state, event, "participantJoined while pending invite");
            }
            // DM rejoin: peer already had a media connection but they re-joined.
            if (
                ctx.kind === "dm" &&
                (state.tag === "signaling" || state.tag === "joining") &&
                ctx.hasJoined &&
                ctx.hasActivePeer[event.participant] &&
                !ctx.liveMediaReady[event.participant]
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

            const rejoiningAfterPartialLeave =
                ctx.kind === "group" &&
                (state.tag === "signaling" || state.tag === "ready") &&
                state.departedPeers?.[event.participant] === true;

            let peerSlots: Record<string, AvPeerSlotState> =
                state.tag === "signaling" || state.tag === "ready"
                    ? { ...state.peerSlots }
                    : {};
            let departedPeers: AvDepartedPeers | undefined =
                state.tag === "signaling" || state.tag === "ready"
                    ? { ...state.departedPeers }
                    : undefined;
            if (rejoiningAfterPartialLeave && departedPeers) {
                const { [event.participant]: _removed, ...rest } = departedPeers;
                departedPeers = Object.keys(rest).length > 0 ? rest : undefined;
            }
            peerSlots[event.participant] = "connecting";

            const signalingJoined =
                state.tag === "signaling" || state.tag === "ready"
                    ? state.signalingJoined
                    : ctx.hasJoined;

            for (const remote of onlineRemotes(ctx)) {
                if (!peerSlots[remote]) {
                    peerSlots[remote] = ctx.liveMediaReady[remote]
                        ? "ready"
                        : "connecting";
                }
            }

            const nextState: AvRunMachineState = {
                tag: "signaling",
                sessionId: event.sessionId,
                peerSlots,
                signalingJoined,
                departedPeers,
            };

            const commands: AvRunCommand[] = [
                { type: "beginSignaling", sessionId: event.sessionId },
            ];
            const peerSlot =
                state.tag === "signaling" || state.tag === "ready"
                    ? state.peerSlots[event.participant]
                    : undefined;
            const participantDeparted =
                state.tag === "signaling" || state.tag === "ready"
                    ? departedPeers?.[event.participant] === true
                    : false;
            const needsPeerRecycle =
                rejoiningAfterPartialLeave ||
                participantDeparted ||
                peerSlot === "absent";
            if (ctx.kind === "group" && needsPeerRecycle) {
                commands.unshift({
                    type: "disposePeer",
                    remoteAccount: event.participant,
                });
            }
            if (
                ctx.kind === "group" &&
                ctx.liveMediaReady[event.participant] !== true
            ) {
                commands.push({
                    type: "resendOffer",
                    remoteAccount: event.participant,
                });
            }
            return { state: nextState, commands };
        }

        case "beginSignaling": {
            if (
                state.tag === "idle" ||
                state.tag === "failed" ||
                state.tag === "pendingInvite"
            ) {
                return ignore(state, event, "beginSignaling without active run");
            }
            if (state.tag === "ensuring" || state.tag === "creating") {
                return ignore(
                    state,
                    event,
                    "beginSignaling before session resolved",
                );
            }
            return {
                state:
                    state.tag === "waitingPeer" || state.tag === "joining"
                        ? withSignaling(event.sessionId, ctx, {}, ctx.hasJoined)
                        : state,
                commands: [
                    { type: "beginSignaling", sessionId: event.sessionId },
                ],
            };
        }

        case "joinedSignaling": {
            if (
                state.tag !== "signaling" &&
                state.tag !== "joining" &&
                state.tag !== "ready" &&
                state.tag !== "waitingPeer"
            ) {
                return ignore(state, event, "joinedSignaling unexpected phase");
            }
            if (state.tag === "joining" || state.tag === "waitingPeer") {
                return {
                    state: withSignaling(event.sessionId, ctx, {}, true),
                    commands: [],
                };
            }
            return {
                state:
                    state.tag === "signaling" || state.tag === "ready"
                        ? { ...state, signalingJoined: true }
                        : state,
                commands: [],
            };
        }

        case "signalingDeferred":
            return {
                state: { tag: "waitingPeer", sessionId: event.sessionId },
                commands: [],
            };

        case "localMediaReady":
            return { state, commands: [] };

        case "mediaConnected": {
            const sessionId = currentSessionId(state);
            if (
                !sessionId ||
                state.tag === "idle" ||
                state.tag === "failed" ||
                state.tag === "pendingInvite" ||
                state.tag === "ensuring" ||
                state.tag === "creating"
            ) {
                return ignore(state, event, "mediaConnected without session");
            }
            const baseSlots: Record<string, AvPeerSlotState> =
                state.tag === "signaling" || state.tag === "ready"
                    ? { ...state.peerSlots }
                    : {};
            for (const remote of onlineRemotes(ctx)) {
                if (!baseSlots[remote]) {
                    baseSlots[remote] = ctx.liveMediaReady[remote]
                        ? "ready"
                        : "connecting";
                }
            }
            baseSlots[event.remoteAccount] = "ready";

            const signalingJoined =
                state.tag === "signaling" || state.tag === "ready"
                    ? state.signalingJoined
                    : ctx.hasJoined;
            const ready = allOnlineSlotsReady(ctx, baseSlots);
            const nextState: AvRunMachineState = ready
                ? {
                      tag: "ready",
                      sessionId,
                      peerSlots: baseSlots,
                      signalingJoined,
                  }
                : {
                      tag: "signaling",
                      sessionId,
                      peerSlots: baseSlots,
                      signalingJoined,
                  };

            return {
                state: nextState,
                commands: [
                    { type: "cancelRecovery" },
                    {
                        type: "notifyMediaReady",
                        remoteAccount: event.remoteAccount,
                    },
                ],
            };
        }

        case "mediaLost": {
            const sessionId = currentSessionId(state);
            if (!sessionId) {
                return ignore(state, event, "mediaLost without session");
            }
            const baseSlots: Record<string, AvPeerSlotState> =
                state.tag === "signaling" || state.tag === "ready"
                    ? { ...state.peerSlots }
                    : {};
            baseSlots[event.remoteAccount] = "absent";
            const signalingJoined =
                state.tag === "signaling" || state.tag === "ready"
                    ? state.signalingJoined
                    : ctx.hasJoined;
            return {
                state: withSignaling(
                    sessionId,
                    ctx,
                    baseSlots,
                    signalingJoined,
                ),
                commands: [
                    {
                        type: "disposePeer",
                        remoteAccount: event.remoteAccount,
                    },
                    { type: "scheduleRecovery", sessionId },
                ],
            };
        }

        case "transportTornDown": {
            const sessionId =
                event.sessionId ?? currentSessionId(state);
            if (!sessionId) {
                return {
                    state,
                    commands: [
                        { type: "disposeAllPeers" },
                        { type: "releaseLocalMedia" },
                    ],
                };
            }
            return {
                state: withSignaling(sessionId, ctx, {}, false),
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
            const sessionId = currentSessionId(state);
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
                    state: withSignaling(sessionId, ctx, {}, false),
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
                !ctx.liveMediaReady[event.account]
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
                ctx.liveMediaReady[event.account] &&
                (state.tag === "ready" || state.tag === "signaling")
            ) {
                const departed =
                    state.tag === "signaling" || state.tag === "ready"
                        ? state.departedPeers?.[event.account] === true
                        : false;
                const slot =
                    state.tag === "signaling" || state.tag === "ready"
                        ? state.peerSlots[event.account]
                        : undefined;
                if (!departed && slot !== "absent") {
                    return ignore(state, event, "group peer already connected");
                }
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
            if (
                state.tag === "failed" ||
                state.tag === "idle" ||
                state.tag === "pendingInvite"
            ) {
                return ignore(
                    state,
                    event,
                    "presenceOffline in idle/failed/pending",
                );
            }
            if (ctx.kind === "group") {
                const sessionId = currentSessionId(state);
                if (!sessionId) {
                    return ignore(state, event, "presenceOffline without session");
                }
                const commands: AvRunCommand[] = [];
                if (
                    ctx.hasActivePeer[event.account] ||
                    state.tag === "signaling" ||
                    state.tag === "ready"
                ) {
                    commands.push({
                        type: "disposePeer",
                        remoteAccount: event.account,
                    });
                }
                const remainingOnline = onlineRemotes(ctx).filter(
                    (m) => m !== event.account,
                );
                if (remainingOnline.length === 0 && ctx.hasJoined) {
                    return {
                        state: { tag: "waitingPeer", sessionId },
                        commands,
                    };
                }
                if (state.tag === "waitingPeer") {
                    return { state, commands };
                }
                const peerSlots: Record<string, AvPeerSlotState> = {
                    ...(state.tag === "signaling" || state.tag === "ready"
                        ? state.peerSlots
                        : {}),
                    [event.account]: "absent",
                };
                const signalingJoined =
                    state.tag === "signaling" || state.tag === "ready"
                        ? state.signalingJoined
                        : ctx.hasJoined;
                return {
                    state: {
                        tag: "signaling",
                        sessionId,
                        peerSlots,
                        signalingJoined,
                        departedPeers:
                            state.tag === "signaling" || state.tag === "ready"
                                ? state.departedPeers
                                : undefined,
                    },
                    commands,
                };
            }
            const sessionId =
                state.tag === "signaling" ||
                state.tag === "ready" ||
                state.tag === "waitingPeer" ||
                state.tag === "joining"
                    ? state.sessionId
                    : undefined;
            if (!sessionId) {
                return ignore(state, event, "presenceOffline without session");
            }
            return {
                state: { tag: "waitingPeer", sessionId },
                commands: [{ type: "disposeAllPeers" }],
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
            const sessionId = event.sessionId;
            const activeSessionId = currentSessionId(state);
            if (state.tag === "idle") {
                return ignore(state, event, "sessionEnded after local hangup");
            }
            if (
                state.tag === "failed" &&
                activeSessionId === sessionId
            ) {
                return ignore(state, event, "duplicate sessionEnded");
            }
            if (state.tag === "pendingInvite") {
                // Delayed timeout/cleanup from a prior call round must not cancel
                // a fresh ring; only the inviting host ending the session counts.
                if (event.by && event.by !== state.from) {
                    return ignore(
                        state,
                        event,
                        "sessionEnded during pending invite (not from host)",
                    );
                }
            }
            if (
                activeSessionId &&
                activeSessionId !== sessionId
            ) {
                return ignore(state, event, "sessionEnded session mismatch");
            }
            if (
                isGroupRemoteVoluntaryDeparture(ctx, event.by) &&
                (state.tag === "signaling" || state.tag === "ready")
            ) {
                return handleGroupRemoteDeparture(state, event.by!, event.reason);
            }
            const commands = fullTeardownCommands(sessionId, event.reason, {
                hasJoined: ctx.hasJoined,
                timeline: "commitSessionEnded",
            });
            return {
                state: { tag: "failed", sessionId, lastError: event.reason },
                commands,
            };
        }

        case "failed": {
            const sessionId = currentSessionId(state);
            const commands = fullTeardownCommands(sessionId, event.detail, {
                hasJoined: ctx.hasJoined,
                timeline: "commitSessionFailed",
            });
            return {
                state: { tag: "failed", sessionId, lastError: event.detail },
                commands,
            };
        }

        case "hangup": {
            const sessionId = currentSessionId(state);
            const commands: AvRunCommand[] = [
                { type: "cancelRecovery" },
                { type: "disposeAllPeers" },
                { type: "releaseLocalMedia" },
            ];
            if (
                sessionId &&
                ctx.hasJoined &&
                state.tag !== "failed" &&
                state.tag !== "idle"
            ) {
                commands.push({
                    type: "leaveSession",
                    sessionId,
                    reason: event.reason,
                });
                if (ctx.kind === "group") {
                    commands.push({
                        type: "commitParticipantLeft",
                        sessionId,
                        reason: event.reason,
                    });
                    return { state: { tag: "idle" }, commands };
                }
                commands.push({
                    type: "commitSessionEnded",
                    sessionId,
                    reason: event.reason,
                });
            }
            return {
                state: { tag: "failed", sessionId, lastError: event.reason },
                commands,
            };
        }

        case "remoteSignal": {
            if (state.tag === "pendingInvite") {
                return ignore(state, event, "remoteSignal while pending invite");
            }
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
        }

        case "dispose": {
            const sessionId = currentSessionId(state);
            const commands: AvRunCommand[] = [
                { type: "cancelRecovery" },
                { type: "disposeAllPeers" },
                { type: "releaseLocalMedia" },
            ];
            if (
                sessionId &&
                ctx.hasJoined &&
                state.tag !== "idle" &&
                state.tag !== "failed" &&
                state.tag !== "ensuring" &&
                state.tag !== "creating"
            ) {
                commands.push({
                    type: "leaveSession",
                    sessionId,
                    reason: "client-disposed",
                });
            }
            return { state: { tag: "idle" }, commands };
        }

        default:
            return ignore(state, event, "unknown event");
    }
}
