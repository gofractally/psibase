import type { MutableRefObject } from "react";

import type { ConversationSnapshot } from "../../lib/protocol";
import type { GroupMeetLifecycleBySpace } from "../../lib/group-meet-lifecycle-ui";

import { avCallTeardownLog } from "../../lib/av-call-debug";
import type { AvCallSessionOrchestrator } from "../../lib/av-call-session-orchestrator";
import { fetchActiveAvCallSession } from "../../lib/chat-api";
import {
    beginGroupMeetLeave,
    completeGroupMeetLeave,
} from "../../lib/group-meet-lifecycle-ui";
import {
    consumeVoluntaryGroupMeetLeave,
    peekVoluntaryGroupMeetLeave,
} from "../../lib/group-meet-voluntary-leave";
import type { ActiveCall } from "./chat-socket-types";

type GroupMeetRejoinHint = {
    spaceUuid: string;
    sessionId: string;
    joinedCount: number;
} | null;

type SetActiveCall = (
    update: ActiveCall | null | ((prev: ActiveCall | null) => ActiveCall | null),
) => void;
type SetGroupMeetRejoinHint = (
    update: GroupMeetRejoinHint | ((prev: GroupMeetRejoinHint) => GroupMeetRejoinHint),
) => void;

export type EndPlaceholderCallDeps = {
    ringOutTimerRef: MutableRefObject<ReturnType<
        typeof globalThis.setTimeout
    > | null>;
    activeCallRef: MutableRefObject<ActiveCall | null>;
    selfRef: MutableRefObject<string | null>;
    avCallOrchestratorRef: MutableRefObject<AvCallSessionOrchestrator | null>;
    hangupInitiatedCallIdRef: MutableRefObject<string | null>;
    hangupInProgressSpaceRef: MutableRefObject<string | null>;
    groupMeetLifecycleRef: MutableRefObject<GroupMeetLifecycleBySpace>;
    conversationsRef: MutableRefObject<ConversationSnapshot[]>;
    avCallUiArmedRef: MutableRefObject<string | null>;
    setActiveCall: SetActiveCall;
    setGroupMeetRejoinHint: SetGroupMeetRejoinHint;
    clearAvCallMedia: () => void;
    refreshObjectiveCallEventsForSpaceRef: MutableRefObject<
        (spaceUuid: string) => Promise<void>
    >;
    setLastInboundError: (value: string | null) => void;
};

/** Meet hangup / leave / cancel — mirrors `endPlaceholderCall` from the original composition hook. */
export function createEndPlaceholderCall(deps: EndPlaceholderCallDeps) {
    const {
        ringOutTimerRef,
        activeCallRef,
        selfRef,
        avCallOrchestratorRef,
        hangupInitiatedCallIdRef,
        hangupInProgressSpaceRef,
        groupMeetLifecycleRef,
        conversationsRef,
        avCallUiArmedRef,
        setActiveCall,
        setGroupMeetRejoinHint,
        clearAvCallMedia,
        refreshObjectiveCallEventsForSpaceRef,
        setLastInboundError,
    } = deps;

    return () => {
        if (ringOutTimerRef.current != null) {
            globalThis.clearTimeout(ringOutTimerRef.current);
            ringOutTimerRef.current = null;
        }
        const ac = activeCallRef.current;
        const selfAtLeave = selfRef.current;
        if (!ac) {
            avCallTeardownLog("ui.endPlaceholderCall skipped", {
                self: selfAtLeave ?? undefined,
                reason: "no activeCall",
            });
            return;
        }
        const groupVoluntaryIntent =
            ac.source === "av-call" &&
            ac.callKind === "group" &&
            !!selfAtLeave &&
            peekVoluntaryGroupMeetLeave(selfAtLeave);
        if (
            ac.source === "av-call" &&
            ac.callKind === "group" &&
            !groupVoluntaryIntent
        ) {
            avCallTeardownLog("ui.endPlaceholderCall suppressed", {
                self: selfAtLeave ?? undefined,
                reason: "group leave without voluntary intent",
                spaceUuid: ac.conversationId,
            });
            return;
        }
        const orch = avCallOrchestratorRef.current;
        const run = orch?.getRun(ac.conversationId);
        if (
            ac.source === "av-call" &&
            ac.callKind === "group" &&
            run?.kind === "group" &&
            run.hasJoined &&
            ac.status !== "connected" &&
            run.snapshot.phase !== "ready" &&
            Date.now() - ac.startedAt < 10_000
        ) {
            avCallTeardownLog("ui.endPlaceholderCall skipped", {
                self: selfAtLeave ?? undefined,
                reason: "group join settling",
                spaceUuid: ac.conversationId,
            });
            return;
        }
        if (
            ac.source === "av-call" &&
            ac.direction === "incoming" &&
            ac.status !== "connected" &&
            Date.now() - ac.startedAt < 5_000
        ) {
            avCallTeardownLog("ui.endPlaceholderCall skipped", {
                self: selfAtLeave ?? undefined,
                reason: "incoming accept settling",
                spaceUuid: ac.conversationId,
            });
            return;
        }
        if (hangupInitiatedCallIdRef.current === ac.callId) {
            avCallTeardownLog("ui.endPlaceholderCall skipped", {
                self: selfAtLeave ?? undefined,
                reason: "hangup already initiated",
                callId: ac.callId,
                spaceUuid: ac.conversationId,
            });
            return;
        }
        if (groupVoluntaryIntent && selfAtLeave) {
            consumeVoluntaryGroupMeetLeave(selfAtLeave);
            groupMeetLifecycleRef.current = beginGroupMeetLeave(
                groupMeetLifecycleRef.current,
                ac.conversationId,
            );
            orch?.beginGroupMeetLeave(ac.conversationId);
        }
        hangupInitiatedCallIdRef.current = ac.callId;
        hangupInProgressSpaceRef.current = ac.conversationId;

        const self = selfRef.current;
        const sessionId = run?.snapshot.sessionId;
        const conversation = conversationsRef.current.find(
            (row) => row.conversationId === ac.conversationId,
        );
        let rejoinHint: {
            spaceUuid: string;
            sessionId: string;
            joinedCount: number;
        } | null = null;
        if (
            ac.source === "av-call" &&
            ac.callKind === "group" &&
            self &&
            sessionId
        ) {
            const joinedCount =
                orch?.getAvCallSessionRosterJoinedCount(sessionId) ?? 0;
            const memberCount = conversation?.members.length ?? 0;
            if (joinedCount > 1) {
                rejoinHint = {
                    spaceUuid: ac.conversationId,
                    sessionId,
                    joinedCount: joinedCount - 1,
                };
            } else if (orch?.othersStillJoinedInGroupMeet(sessionId, self)) {
                rejoinHint = {
                    spaceUuid: ac.conversationId,
                    sessionId,
                    joinedCount: Math.max(0, joinedCount - 1),
                };
            } else if (memberCount > 2) {
                rejoinHint = {
                    spaceUuid: ac.conversationId,
                    sessionId,
                    joinedCount: memberCount - 1,
                };
            }
        }
        const reason =
            ac.source === "av-call" &&
            ac.status === "ringing" &&
            ac.direction === "outgoing" &&
            !(
                ac.callKind === "group" &&
                sessionId &&
                self &&
                orch?.othersStillJoinedInGroupMeet(sessionId, self)
            )
                ? "cancelled"
                : ac.callKind === "group"
                  ? "left"
                  : "ended";

        avCallTeardownLog("ui.endPlaceholderCall", {
            self: self ?? undefined,
            spaceUuid: ac.conversationId,
            sessionId,
            reason,
            callKind: ac.callKind,
            status: ac.status,
            phase: run?.snapshot.phase,
            hasJoined: run?.hasJoined,
            stack: new Error().stack?.split("\n").slice(1, 4).join(" | "),
        });

        if (ac.source === "av-call") {
            if (ac.callKind === "group") {
                groupMeetLifecycleRef.current = completeGroupMeetLeave(
                    groupMeetLifecycleRef.current,
                    ac.conversationId,
                    rejoinHint,
                );
                orch?.completeGroupMeetLeave(ac.conversationId, rejoinHint);
            }
            avCallUiArmedRef.current = null;
            clearAvCallMedia();
            setActiveCall(null);
            if (rejoinHint) {
                setGroupMeetRejoinHint(rejoinHint);
            }
        }

        void (async () => {
            if (ac.source === "av-call") {
                try {
                    await orch?.hangupAvCallSession(ac.conversationId, reason);
                } finally {
                    hangupInitiatedCallIdRef.current = null;
                    setActiveCall((prev) =>
                        prev?.conversationId === ac.conversationId &&
                        prev.source === "av-call"
                            ? null
                            : prev,
                    );
                    avCallOrchestratorRef.current?.clearRun(ac.conversationId);
                    void refreshObjectiveCallEventsForSpaceRef.current(
                        ac.conversationId,
                    );
                    hangupInProgressSpaceRef.current = null;
                }

                if (ac.callKind === "group" && self && sessionId) {
                    try {
                        const active = await fetchActiveAvCallSession(
                            ac.conversationId,
                        );
                        if (!active || active.lifecycle !== 1) {
                            rejoinHint = null;
                        } else {
                            const others = active.participants.filter(
                                (p) => p !== self,
                            );
                            if (others.length === 0) {
                                rejoinHint = null;
                            } else {
                                rejoinHint = {
                                    spaceUuid: ac.conversationId,
                                    sessionId: active.session_id,
                                    joinedCount: others.length,
                                };
                            }
                        }
                    } catch {
                        if (
                            !orch?.othersStillJoinedInGroupMeet(sessionId, self)
                        ) {
                            rejoinHint = null;
                        }
                    }
                }
                if (rejoinHint) {
                    setGroupMeetRejoinHint(rejoinHint);
                } else if (ac.callKind === "group") {
                    setGroupMeetRejoinHint((prev) =>
                        prev?.spaceUuid === ac.conversationId ? null : prev,
                    );
                }
                if (ac.callKind === "group") {
                    groupMeetLifecycleRef.current = completeGroupMeetLeave(
                        groupMeetLifecycleRef.current,
                        ac.conversationId,
                        rejoinHint,
                    );
                    orch?.completeGroupMeetLeave(ac.conversationId, rejoinHint);
                }
            } else {
                hangupInProgressSpaceRef.current = null;
                hangupInitiatedCallIdRef.current = null;
                setLastInboundError(null);
                setActiveCall(null);
            }
        })();
    };
}
