import { normalizeAvCallTerminalReason } from "./av-call-terminal";
import {
    CHAT_WEBRTC_EVENT_PARTICIPANT_JOINED,
    CHAT_WEBRTC_EVENT_PARTICIPANT_LEFT,
    CHAT_WEBRTC_EVENT_SESSION_ENDED,
    CHAT_WEBRTC_EVENT_SESSION_FAILED,
    commitWebRtcSessionEvent,
} from "./chat-api";

export function avCallTimelineCommitKind(reason: string): number {
    const normalized = normalizeAvCallTerminalReason(reason);
    if (
        normalized === "timeout" ||
        normalized === "missed" ||
        normalized === "transport"
    ) {
        return CHAT_WEBRTC_EVENT_SESSION_FAILED;
    }
    return CHAT_WEBRTC_EVENT_SESSION_ENDED;
}

export function commitAvCallJoin(sessionId: string): void {
    void commitWebRtcSessionEvent(
        sessionId,
        CHAT_WEBRTC_EVENT_PARTICIPANT_JOINED,
        "joined",
    ).catch(() => {
        /* Non-fatal; timeline may lag until retry. */
    });
}

/** Group partial leave — objective session stays active for remaining participants. */
export function commitAvCallParticipantLeft(
    sessionId: string,
    reason: string,
): void {
    const normalized = normalizeAvCallTerminalReason(reason);
    void commitWebRtcSessionEvent(
        sessionId,
        CHAT_WEBRTC_EVENT_PARTICIPANT_LEFT,
        normalized,
    ).catch(() => {
        /* Non-fatal; timeline may lag until retry. */
    });
}

/** Commits SESSION_ENDED — closes the objective session for all participants. */
export function commitAvCallSessionEnded(
    sessionId: string,
    reason: string,
): void {
    const normalized = normalizeAvCallTerminalReason(reason);
    void commitWebRtcSessionEvent(
        sessionId,
        CHAT_WEBRTC_EVENT_SESSION_ENDED,
        normalized,
    ).catch(() => {
        /* Non-fatal; timeline may lag until retry. */
    });
}

/** Commits SESSION_FAILED — terminal failure for the objective session. */
export function commitAvCallSessionFailed(
    sessionId: string,
    reason: string,
): void {
    const normalized = normalizeAvCallTerminalReason(reason);
    void commitWebRtcSessionEvent(
        sessionId,
        CHAT_WEBRTC_EVENT_SESSION_FAILED,
        normalized,
    ).catch(() => {
        /* Non-fatal; timeline may lag until retry. */
    });
}

export function commitAvCallTimelineEvent(
    sessionId: string,
    reason: string,
): void {
    const normalized = normalizeAvCallTerminalReason(reason);
    void commitWebRtcSessionEvent(
        sessionId,
        avCallTimelineCommitKind(normalized),
        normalized,
    ).catch(() => {
        /* Non-fatal; timeline may lag until retry. */
    });
}
