import {
    onlineRemotes,
    participatingOnlineRemotes,
} from "./av-call-run-state-machine-snapshot";
import type {
    AvDepartedPeers,
    AvPeerSlotState,
    AvRunCommand,
    AvRunContext,
    AvRunEvent,
    AvRunMachineState,
    AvTransitionResult,
} from "./av-call-run-state-machine-types";

/**
 * Shared helpers for the `avTransition` reducer (`av-call-run-state-machine-core.ts`):
 * peer-slot bookkeeping, the `ignore` result builder, and group voluntary-departure
 * handling. Not part of the public façade — only imported by the core reducer.
 */

export function withSignaling(
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

export function ignore(
    state: AvRunMachineState,
    event: AvRunEvent,
    reason: string,
): AvTransitionResult {
    return {
        state,
        commands: [{ type: "logIgnored", event, reason }],
    };
}

export function currentSessionId(
    state: AvRunMachineState,
): string | undefined {
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

export function isGroupRemoteVoluntaryDeparture(
    ctx: AvRunContext,
    by: string | undefined,
): boolean {
    if (ctx.kind !== "group" || !by || by === ctx.self) return false;
    if (ctx.members.includes(by)) return true;
    return ctx.sessionJoinedParticipants?.includes(by) === true;
}

export function isGroupInCallPhase(state: AvRunMachineState): boolean {
    return (
        state.tag === "signaling" ||
        state.tag === "ready" ||
        state.tag === "waitingPeer" ||
        state.tag === "joining"
    );
}

export function markDeparted(
    departedPeers: AvDepartedPeers | undefined,
    account: string,
): AvDepartedPeers {
    return { ...departedPeers, [account]: true };
}

export function isAlreadyDeparted(
    state: AvRunMachineState,
    account: string,
): boolean {
    if (state.tag !== "signaling" && state.tag !== "ready") {
        return false;
    }
    return state.departedPeers?.[account] === true;
}

export function fullTeardownCommands(
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

export function handleGroupRemoteDeparture(
    state: Extract<
        AvRunMachineState,
        { tag: "signaling" | "ready" | "waitingPeer" | "joining" }
    >,
    remote: string,
    reason: string,
    ctx: AvRunContext,
): AvTransitionResult {
    if (isAlreadyDeparted(state, remote)) {
        return ignore(
            state,
            { type: "sessionEnded", sessionId: state.sessionId, reason, by: remote },
            "duplicate remote departure",
        );
    }
    const peerSlots =
        state.tag === "signaling" || state.tag === "ready"
            ? { ...state.peerSlots, [remote]: "absent" as const }
            : { [remote]: "absent" as const };
    const departedPeers =
        state.tag === "signaling" || state.tag === "ready"
            ? markDeparted(state.departedPeers, remote)
            : { [remote]: true as const };
    const rejoinedPeers =
        state.tag === "signaling" || state.tag === "ready"
            ? (() => {
                  if (!state.rejoinedPeers?.[remote]) return state.rejoinedPeers;
                  const { [remote]: _removed, ...rest } = state.rejoinedPeers;
                  return Object.keys(rest).length > 0 ? rest : undefined;
              })()
            : undefined;
    const active = participatingOnlineRemotes(ctx, peerSlots, departedPeers);
    const anyStillReady = active.some(
        (member) =>
            peerSlots[member] === "ready" ||
            ctx.liveMediaReady[member] === true,
    );
    const nextTag =
        state.tag === "waitingPeer" || state.tag === "joining"
            ? state.tag
            : anyStillReady
              ? "ready"
              : "signaling";
    const nextState =
        state.tag === "signaling" || state.tag === "ready"
            ? {
                  tag: nextTag as "signaling" | "ready",
                  sessionId: state.sessionId,
                  peerSlots,
                  signalingJoined: state.signalingJoined,
                  departedPeers,
                  rejoinedPeers,
              }
            : {
                  tag: state.tag,
                  sessionId: state.sessionId,
              };
    return {
        state: nextState,
        commands: [{ type: "disposePeer", remoteAccount: remote }],
    };
}
