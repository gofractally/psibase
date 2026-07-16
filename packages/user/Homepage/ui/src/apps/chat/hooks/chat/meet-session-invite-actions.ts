import type { MutableRefObject } from "react";

import type { PresenceUi } from "../../lib/chat-timeline-types";
import type { ConversationSnapshot } from "../../lib/protocol";
import type { GraphqlSpaceEntry } from "../../lib/space-bridge";
import type { GroupMeetLifecycleBySpace } from "../../lib/group-meet-lifecycle-ui";

import type {
    AvCallIncomingInvite,
    AvCallSessionOrchestrator,
} from "../../lib/av-call-session-orchestrator";
import { needsSpaceReloadForAvCallInvite } from "../../lib/dm-contacts-meet-flow";
import {
    clearGroupMeetLifecycle,
    markGroupMeetActive,
    rejoinHintFromLifecycle,
} from "../../lib/group-meet-lifecycle-ui";
import {
    buildGroupMeetParticipants,
    groupMeetDisplayPeer,
    groupMeetStatusLabel,
} from "../../lib/group-meet-ui-state";
import type { ActiveCall, IncomingCall } from "./chat-socket-types";

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

export type AcceptIncomingCallDeps = {
    avCallOrchestratorRef: MutableRefObject<AvCallSessionOrchestrator | null>;
    avCallDirectionRef: MutableRefObject<"incoming" | "outgoing">;
    avCallUiArmedRef: MutableRefObject<string | null>;
    setIncomingAvCallInvite: (invite: AvCallIncomingInvite | null) => void;
    selfRef: MutableRefObject<string | null>;
    objectiveSpacesRef: MutableRefObject<GraphqlSpaceEntry[]>;
    contactAccountsRef: MutableRefObject<Set<string>>;
    contactsLoadedRef: MutableRefObject<boolean>;
    loadObjectiveSpaces: () => Promise<GraphqlSpaceEntry[]>;
    setSelectedConversationId: (
        id: string | undefined,
        source?: string,
    ) => void;
    presenceByAccountRef: MutableRefObject<Record<string, PresenceUi>>;
    setActiveCall: SetActiveCall;
};

export function createAcceptIncomingCall(deps: AcceptIncomingCallDeps) {
    const {
        avCallOrchestratorRef,
        avCallDirectionRef,
        avCallUiArmedRef,
        setIncomingAvCallInvite,
        selfRef,
        objectiveSpacesRef,
        contactAccountsRef,
        contactsLoadedRef,
        loadObjectiveSpaces,
        setSelectedConversationId,
        presenceByAccountRef,
        setActiveCall,
    } = deps;

    return () => {
        const avInvite = avCallOrchestratorRef.current?.getPendingInvite();
        if (avInvite) {
            // Dismiss the ring dialog immediately so a late onOpenChange/timeout
            // cannot decline after accept begins (loadObjectiveSpaces can take seconds).
            avCallDirectionRef.current = "incoming";
            avCallUiArmedRef.current = avInvite.spaceUuid;
            setIncomingAvCallInvite(null);
            void (async () => {
                const self = selfRef.current;
                if (
                    self &&
                    needsSpaceReloadForAvCallInvite(
                        avInvite.spaceUuid,
                        self,
                        objectiveSpacesRef.current,
                        contactAccountsRef.current,
                        contactsLoadedRef.current,
                    )
                ) {
                    try {
                        await loadObjectiveSpaces();
                    } catch {
                        /* accept still proceeds; UI may catch up on next refresh */
                    }
                }

                avCallOrchestratorRef.current?.acceptIncomingInvite();
                setSelectedConversationId(avInvite.spaceUuid);
                const isGroupInvite =
                    (avInvite.participants?.length ?? 0) > 2 &&
                    !!self &&
                    !!avInvite.participants;
                const groupParticipants = isGroupInvite
                    ? buildGroupMeetParticipants(
                          avInvite.participants!,
                          self!,
                          presenceByAccountRef.current,
                          {},
                          "signaling",
                      )
                    : undefined;
                setActiveCall({
                    callId: avInvite.sessionId,
                    conversationId: avInvite.spaceUuid,
                    peerAccount: isGroupInvite
                        ? groupMeetDisplayPeer(groupParticipants!)
                        : avInvite.from,
                    direction: "incoming",
                    wantVideo: avInvite.wantVideo,
                    wantAudio: avInvite.wantAudio,
                    startedAt: Date.now(),
                    status: "ringing",
                    source: "av-call",
                    lastFrame: isGroupInvite
                        ? groupMeetStatusLabel(
                              groupParticipants!,
                              "signaling",
                              false,
                          )
                        : "Connecting…",
                    callKind: isGroupInvite ? "group" : "dm",
                    groupParticipants,
                });
            })();
            return;
        }
    };
}

export type DeclineIncomingCallDeps = {
    avCallOrchestratorRef: MutableRefObject<AvCallSessionOrchestrator | null>;
    avCallUiArmedRef: MutableRefObject<string | null>;
    setIncomingAvCallInvite: (invite: AvCallIncomingInvite | null) => void;
    activeCallRef: MutableRefObject<ActiveCall | null>;
    setIncomingCall: (call: IncomingCall | null) => void;
};

export function createDeclineIncomingCall(deps: DeclineIncomingCallDeps) {
    const {
        avCallOrchestratorRef,
        avCallUiArmedRef,
        setIncomingAvCallInvite,
        activeCallRef,
        setIncomingCall,
    } = deps;

    return (reason: "user" | "timeout") => {
        const avInvite = avCallOrchestratorRef.current?.getPendingInvite();
        if (avInvite) {
            if (avCallUiArmedRef.current === avInvite.spaceUuid) {
                setIncomingAvCallInvite(null);
                return;
            }
            const active = activeCallRef.current;
            const run = avCallOrchestratorRef.current?.getRun(
                avInvite.spaceUuid,
            );
            if (
                active?.source === "av-call" &&
                active.conversationId === avInvite.spaceUuid
            ) {
                setIncomingAvCallInvite(null);
                return;
            }
            if (
                run &&
                run.hasJoined &&
                run.snapshot.phase !== "idle" &&
                run.snapshot.phase !== "failed"
            ) {
                setIncomingAvCallInvite(null);
                return;
            }
            avCallOrchestratorRef.current?.declineIncomingInvite(reason);
            setIncomingAvCallInvite(null);
            return;
        }
        setIncomingCall(null);
    };
}

export type RejoinGroupMeetCallDeps = {
    selfRef: MutableRefObject<string | null>;
    avCallOrchestratorRef: MutableRefObject<AvCallSessionOrchestrator | null>;
    conversationsRef: MutableRefObject<ConversationSnapshot[]>;
    setGroupMeetRejoinHint: SetGroupMeetRejoinHint;
    groupMeetRejoinHintRef: MutableRefObject<GroupMeetRejoinHint>;
    groupMeetLifecycleRef: MutableRefObject<GroupMeetLifecycleBySpace>;
    avCallDirectionRef: MutableRefObject<"incoming" | "outgoing">;
    avCallUiArmedRef: MutableRefObject<string | null>;
    setSelectedConversationId: (
        id: string | undefined,
        source?: string,
    ) => void;
    setActiveCall: SetActiveCall;
    presenceByAccountRef: MutableRefObject<Record<string, PresenceUi>>;
};

export function createRejoinGroupMeetCall(deps: RejoinGroupMeetCallDeps) {
    const {
        selfRef,
        avCallOrchestratorRef,
        conversationsRef,
        setGroupMeetRejoinHint,
        groupMeetRejoinHintRef,
        groupMeetLifecycleRef,
        avCallDirectionRef,
        avCallUiArmedRef,
        setSelectedConversationId,
        setActiveCall,
        presenceByAccountRef,
    } = deps;

    return (spaceUuid: string) => {
        const self = selfRef.current;
        const orch = avCallOrchestratorRef.current;
        if (!self || !orch) return;

        const conversation = conversationsRef.current.find(
            (row) => row.conversationId === spaceUuid,
        );
        if (
            !conversation ||
            conversation.kind !== "group" ||
            !conversation.members.includes(self)
        ) {
            return;
        }

        setGroupMeetRejoinHint(null);
        const rejoinHint =
            groupMeetRejoinHintRef.current?.spaceUuid === spaceUuid
                ? groupMeetRejoinHintRef.current
                : rejoinHintFromLifecycle(
                      groupMeetLifecycleRef.current,
                      spaceUuid,
                  );
        if (rejoinHint) {
            orch.beginGroupMeetRejoin(
                spaceUuid,
                rejoinHint.sessionId,
                rejoinHint.joinedCount,
            );
        }
        groupMeetLifecycleRef.current = markGroupMeetActive(
            clearGroupMeetLifecycle(
                groupMeetLifecycleRef.current,
                spaceUuid,
            ),
            spaceUuid,
        );
        orch.markGroupMeetActive(spaceUuid);
        avCallDirectionRef.current = "incoming";
        avCallUiArmedRef.current = spaceUuid;
        setSelectedConversationId(spaceUuid, "rejoinGroupMeet");
        setActiveCall({
            callId: "",
            conversationId: spaceUuid,
            peerAccount: conversation.members.find((m) => m !== self) ?? "",
            direction: "incoming",
            wantVideo: true,
            wantAudio: true,
            startedAt: Date.now(),
            status: "ringing",
            source: "av-call",
            lastFrame: "Connecting…",
            callKind: "group",
            groupParticipants: buildGroupMeetParticipants(
                conversation.members,
                self,
                presenceByAccountRef.current,
                {},
                "signaling",
            ),
        });
        orch.rejoinGroupMeetSession(spaceUuid, conversation.members);
    };
}
