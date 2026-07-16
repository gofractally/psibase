import {
    allOnlineSlotsReady,
    anyPeerMediaReady,
    onlineRemotes,
} from "./av-call-run-state-machine-snapshot";
import {
    currentSessionId,
    fullTeardownCommands,
    handleGroupRemoteDeparture,
    ignore,
    isAlreadyDeparted,
    isGroupInCallPhase,
    isGroupRemoteVoluntaryDeparture,
    withSignaling,
} from "./av-call-run-state-machine-core-helpers";
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
 * The `avTransition` reducer table for the Meet Call FSM. Pure: given
 * `(state, event, ctx)`, returns the next state plus the side-effect
 * `commands` for the caller to execute. See `av-call-run-state-machine.ts`
 * for the public façade and `av-call-run-state-machine-snapshot.ts` for
 * deriving the UI snapshot from this state.
 */
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
            // (offline user discovering an active group call).
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
            if (
                ctx.kind === "group" &&
                ctx.liveMediaReady[event.participant] &&
                (state.tag === "ready" || state.tag === "signaling")
            ) {
                const pendingRejoin =
                    ctx.sessionPendingParticipants?.includes(
                        event.participant,
                    ) === true;
                const departed =
                    state.tag === "signaling" || state.tag === "ready"
                        ? state.departedPeers?.[event.participant] === true
                        : false;
                const slot =
                    state.tag === "signaling" || state.tag === "ready"
                        ? state.peerSlots[event.participant]
                        : undefined;
                if (
                    !pendingRejoin &&
                    !departed &&
                    slot !== "absent"
                ) {
                    return ignore(
                        state,
                        event,
                        "participantJoined for connected peer",
                    );
                }
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
            const pendingRejoin =
                ctx.kind === "group" &&
                ctx.sessionPendingParticipants?.includes(
                    event.participant,
                ) === true;

            let peerSlots: Record<string, AvPeerSlotState> =
                state.tag === "signaling" || state.tag === "ready"
                    ? { ...state.peerSlots }
                    : {};
            let departedPeers: AvDepartedPeers | undefined =
                state.tag === "signaling" || state.tag === "ready"
                    ? { ...state.departedPeers }
                    : undefined;
            let rejoinedPeers: AvDepartedPeers | undefined =
                state.tag === "signaling" || state.tag === "ready"
                    ? { ...state.rejoinedPeers }
                    : undefined;
            if (rejoiningAfterPartialLeave && departedPeers) {
                const { [event.participant]: _removed, ...rest } = departedPeers;
                departedPeers = Object.keys(rest).length > 0 ? rest : undefined;
            }
            if (pendingRejoin) {
                rejoinedPeers = {
                    ...rejoinedPeers,
                    [event.participant]: true,
                };
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
                rejoinedPeers,
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
                pendingRejoin ||
                participantDeparted ||
                peerSlot === "absent" ||
                (ctx.hasActivePeer?.[event.participant] !== true &&
                    ctx.liveMediaReady[event.participant] !== true);
            if (ctx.kind === "group" && needsPeerRecycle) {
                commands.unshift({
                    type: "disposePeer",
                    remoteAccount: event.participant,
                });
            }
            if (
                ctx.kind === "group" &&
                (ctx.liveMediaReady[event.participant] !== true ||
                    ctx.hasActivePeer?.[event.participant] !== true)
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
            if (
                (state.tag === "signaling" || state.tag === "ready") &&
                state.sessionId === event.sessionId
            ) {
                return ignore(state, event, "beginSignaling already active");
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
            if (state.tag === "ensuring" || state.tag === "creating") {
                return {
                    state: withSignaling(
                        event.sessionId,
                        ctx,
                        {},
                        ctx.hasJoined,
                    ),
                    commands: [],
                };
            }
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
            let sessionId = currentSessionId(state);
            if (
                !sessionId &&
                (state.tag === "ensuring" || state.tag === "creating") &&
                ctx.snapshotSessionId
            ) {
                sessionId = ctx.snapshotSessionId;
            }
            if (
                !sessionId ||
                state.tag === "idle" ||
                state.tag === "failed" ||
                state.tag === "pendingInvite"
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
            const departedPeers =
                state.tag === "signaling" || state.tag === "ready"
                    ? state.departedPeers
                    : undefined;
            const ready = allOnlineSlotsReady(ctx, baseSlots, departedPeers);
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
            if (state.tag === "pendingInvite") {
                return ignore(state, event, "presenceOnline while pending invite");
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
                ctx.kind === "group" &&
                ctx.liveMediaReady[event.account] &&
                ctx.hasActivePeer?.[event.account] &&
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
                if (state.tag === "signaling" || state.tag === "ready") {
                    if (isAlreadyDeparted(state, event.account)) {
                        return ignore(
                            state,
                            event,
                            "presenceOffline for departed peer",
                        );
                    }
                    const remainingOnline = onlineRemotes(ctx).filter(
                        (m) => m !== event.account,
                    );
                    if (remainingOnline.length === 0 && ctx.hasJoined) {
                        return {
                            state: { tag: "waitingPeer", sessionId },
                            commands: [
                                {
                                    type: "disposePeer",
                                    remoteAccount: event.account,
                                },
                            ],
                        };
                    }
                    return handleGroupRemoteDeparture(
                        state,
                        event.account,
                        "presence-offline",
                        ctx,
                    );
                }
                if (state.tag === "waitingPeer" || state.tag === "joining") {
                    const commands: AvRunCommand[] = [];
                    if (ctx.hasActivePeer[event.account]) {
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
                    return { state, commands };
                }
                return ignore(state, event, "presenceOffline unexpected phase");
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
                isGroupInCallPhase(state)
            ) {
                const remote = event.by!;
                if (
                    (state.tag === "signaling" || state.tag === "ready") &&
                    state.rejoinedPeers?.[remote] === true
                ) {
                    return ignore(
                        state,
                        event,
                        "stale sessionEnded left (peer rejoined from pending)",
                    );
                }
                if (
                    (state.tag === "signaling" || state.tag === "ready") &&
                    state.peerSlots[remote] === "connecting"
                ) {
                    return ignore(
                        state,
                        event,
                        "stale sessionEnded for rejoining peer",
                    );
                }
                // Voluntary leave is authoritative: delayed notifications must
                // tear down stale mesh even when roster snapshots lag rejoin.
                if (event.reason !== "left") {
                    if (
                        ctx.sessionJoinedParticipants?.includes(remote) &&
                        (state.tag === "signaling" || state.tag === "ready") &&
                        state.peerSlots[remote] !== "absent"
                    ) {
                        return ignore(
                            state,
                            event,
                            "stale sessionEnded (participant in roster)",
                        );
                    }
                    if (
                        (state.tag === "signaling" || state.tag === "ready") &&
                        state.peerSlots[remote] === "ready" &&
                        ctx.hasActivePeer?.[remote]
                    ) {
                        return ignore(
                            state,
                            event,
                            "stale sessionEnded (peer still connected)",
                        );
                    }
                }
                return handleGroupRemoteDeparture(
                    state as Extract<
                        AvRunMachineState,
                        {
                            tag:
                                | "signaling"
                                | "ready"
                                | "waitingPeer"
                                | "joining";
                        }
                    >,
                    event.by!,
                    event.reason,
                    ctx,
                );
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
