import {
    remoteMembers,
    type AvCallSessionPhase,
    type AvCallSessionSnapshot,
} from "./av-call-session-types";
import type {
    AvDepartedPeers,
    AvPeerSlotState,
    AvRunContext,
    AvRunKind,
    AvRunMachineState,
} from "./av-call-run-state-machine-types";

/**
 * Snapshot derivation for the Meet Call FSM: builds the authoritative UI
 * `AvCallSessionSnapshot` from machine state + live peer readiness, plus the
 * selector helpers it (and `av-call-run-state-machine-core.ts`) need. See
 * `av-call-run-state-machine.ts` for the public façade.
 */

export function onlineRemotes(ctx: AvRunContext): string[] {
    return remoteMembers(ctx.members, ctx.self).filter(
        (member) => ctx.presence[member] === "online",
    );
}

/** Online remotes still participating in the call (excludes voluntary leavers). */
export function participatingOnlineRemotes(
    ctx: AvRunContext,
    peerSlots: Record<string, AvPeerSlotState>,
    departedPeers?: AvDepartedPeers,
): string[] {
    return onlineRemotes(ctx).filter(
        (member) =>
            peerSlots[member] !== "absent" &&
            departedPeers?.[member] !== true,
    );
}

export function anyPeerMediaReady(ctx: AvRunContext): boolean {
    return Object.values(ctx.liveMediaReady).some(Boolean);
}

/**
 * Group: ready iff every currently-online remote has its mesh peer media-connected.
 * DM: ready iff the single peer has media connected.
 */
export function allOnlineSlotsReady(
    ctx: AvRunContext,
    peerSlots: Record<string, AvPeerSlotState>,
    departedPeers?: AvDepartedPeers,
): boolean {
    if (ctx.kind === "dm") {
        const peer = ctx.members.find((m) => m !== ctx.self);
        if (!peer) return false;
        return (
            peerSlots[peer] === "ready" || ctx.liveMediaReady[peer] === true
        );
    }
    const active = participatingOnlineRemotes(ctx, peerSlots, departedPeers);
    if (active.length === 0) {
        return anyPeerMediaReady(ctx);
    }
    return active.every(
        (member) =>
            peerSlots[member] === "ready" ||
            ctx.liveMediaReady[member] === true,
    );
}

/** DM objective session: remote must be joined, not only pending, before "ready". */
function dmRemoteJoinedSession(ctx: AvRunContext): boolean {
    if (ctx.kind !== "dm") return true;
    const peer = ctx.members.find((m) => m !== ctx.self);
    if (!peer) return false;
    const joined = ctx.sessionJoinedParticipants;
    if (joined === undefined) return true;
    return joined.includes(peer);
}

/**
 * Live readiness check for the "ready" snapshot derivation. Unlike
 * `allOnlineSlotsReady` (which falls back to recorded slot state), this only
 * trusts the live peer-object state — so a stale `ready` machine state with
 * dropped media falls back to "signaling" until live state agrees.
 */
function liveOnlineMediaReady(
    ctx: AvRunContext,
    peerSlots: Record<string, AvPeerSlotState> = {},
    departedPeers?: AvDepartedPeers,
): boolean {
    if (ctx.kind === "dm") {
        const peer = ctx.members.find((m) => m !== ctx.self);
        if (!peer) return false;
        return ctx.liveMediaReady[peer] === true;
    }
    const active = participatingOnlineRemotes(ctx, peerSlots, departedPeers);
    if (active.length === 0) {
        return anyPeerMediaReady(ctx);
    }
    return active.every((member) => ctx.liveMediaReady[member] === true);
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
                dmRemoteJoinedSession(ctx) &&
                allOnlineSlotsReady(
                    ctx,
                    state.peerSlots,
                    state.departedPeers,
                ) &&
                liveOnlineMediaReady(
                    ctx,
                    state.peerSlots,
                    state.departedPeers,
                )
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
                phase:
                    dmRemoteJoinedSession(ctx) &&
                    liveOnlineMediaReady(
                        ctx,
                        state.peerSlots,
                        state.departedPeers,
                    )
                        ? "ready"
                        : "signaling",
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
