import type { SignalKind } from "./webrtc-signaling-client";

/**
 * Type definitions for the Meet Call FSM (v2b: `mediaLegs`). See
 * `av-call-run-state-machine.ts` for the transition table façade,
 * `av-call-run-state-machine-snapshot.ts` for snapshot derivation, and
 * `av-call-run-state-machine-core.ts` for the `avTransition` reducer.
 */

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
          /** Remotes who rejoined from pending roster (ignore stale leave echo). */
          rejoinedPeers?: AvDepartedPeers;
      }
    | {
          tag: "ready";
          sessionId: string;
          peerSlots: Record<string, AvPeerSlotState>;
          signalingJoined: boolean;
          departedPeers?: AvDepartedPeers;
          rejoinedPeers?: AvDepartedPeers;
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
    /** Run snapshot session id — used when machine state has not caught up yet. */
    snapshotSessionId?: string;
    /** Latest objective-session joined roster from signaling snapshots. */
    sessionJoinedParticipants?: readonly string[];
    /** Latest objective-session pending roster from signaling snapshots. */
    sessionPendingParticipants?: readonly string[];
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
