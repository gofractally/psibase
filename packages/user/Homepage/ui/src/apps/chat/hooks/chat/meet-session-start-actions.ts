import type { MutableRefObject } from "react";

import type { PresenceUi } from "../../lib/chat-timeline-types";
import type { ConversationSnapshot } from "../../lib/protocol";
import type { GraphqlSpaceEntry } from "../../lib/space-bridge";
import type { GroupMeetLifecycleBySpace } from "../../lib/group-meet-lifecycle-ui";

import type { AvCallSessionOrchestrator } from "../../lib/av-call-session-orchestrator";
import { ensureDm } from "../../lib/chat-api";
import { findVisibleDmWithPeer } from "../../lib/dm-contacts-meet-flow";
import {
    getGroupMeetLifecycle,
    markGroupMeetActive,
    rejoinHintFromLifecycle,
} from "../../lib/group-meet-lifecycle-ui";
import { buildGroupMeetParticipants } from "../../lib/group-meet-ui-state";
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

export type StartMeetCallDeps = {
    selfRef: MutableRefObject<string | null>;
    avCallOrchestratorRef: MutableRefObject<AvCallSessionOrchestrator | null>;
    objectiveSpacesRef: MutableRefObject<GraphqlSpaceEntry[]>;
    contactAccountsRef: MutableRefObject<Set<string>>;
    contactsLoadedRef: MutableRefObject<boolean>;
    presenceByAccountRef: MutableRefObject<Record<string, PresenceUi>>;
    selectedConversationId: string | undefined;
    setSelectedConversationId: (
        id: string | undefined,
        source?: string,
    ) => void;
    composePendingDmPeerRef: MutableRefObject<string | null>;
    setComposePendingDmPeer: (value: string | null) => void;
    pendingDmMemberRef: MutableRefObject<string | null>;
    resolveConversationSync: (
        spaceUuid: string,
    ) => ConversationSnapshot | undefined;
    loadObjectiveSpaces: () => Promise<GraphqlSpaceEntry[]>;
    setLastInboundError: (value: string | null) => void;
    avCallDirectionRef: MutableRefObject<"incoming" | "outgoing">;
    avCallUiArmedRef: MutableRefObject<string | null>;
    groupMeetLifecycleRef: MutableRefObject<GroupMeetLifecycleBySpace>;
    groupMeetRejoinHintRef: MutableRefObject<GroupMeetRejoinHint>;
    setGroupMeetRejoinHint: SetGroupMeetRejoinHint;
    setActiveCall: SetActiveCall;
    rejoinGroupMeetCallRef: MutableRefObject<(spaceUuid: string) => void>;
};

export function createStartMeetCall(deps: StartMeetCallDeps) {
    const {
        selfRef,
        avCallOrchestratorRef,
        objectiveSpacesRef,
        contactAccountsRef,
        contactsLoadedRef,
        presenceByAccountRef,
        selectedConversationId,
        setSelectedConversationId,
        composePendingDmPeerRef,
        setComposePendingDmPeer,
        pendingDmMemberRef,
        resolveConversationSync,
        loadObjectiveSpaces,
        setLastInboundError,
        avCallDirectionRef,
        avCallUiArmedRef,
        groupMeetLifecycleRef,
        groupMeetRejoinHintRef,
        setGroupMeetRejoinHint,
        setActiveCall,
        rejoinGroupMeetCallRef,
    } = deps;

    return () => {
        const self = selfRef.current;
        if (!self) return;

        const orch = avCallOrchestratorRef.current;
        if (!orch) return;

        void (async () => {
            let convId = selectedConversationId;
            let conversation = convId
                ? resolveConversationSync(convId)
                : undefined;

            const pendingPeer = composePendingDmPeerRef.current;
            if (!conversation && pendingPeer && pendingPeer !== self) {
                try {
                    await ensureDm(pendingPeer);
                    await loadObjectiveSpaces();
                    conversation = findVisibleDmWithPeer(
                        pendingPeer,
                        self,
                        objectiveSpacesRef.current,
                        contactAccountsRef.current,
                        contactsLoadedRef.current,
                    );
                    if (conversation) {
                        convId = conversation.conversationId;
                        pendingDmMemberRef.current = null;
                        setComposePendingDmPeer(null);
                        setSelectedConversationId(
                            convId,
                            "startMeetCall-ensureDm",
                        );
                    }
                } catch (e) {
                    const detail =
                        e instanceof Error
                            ? e.message
                            : "Could not create DM space for Meet.";
                    setLastInboundError(detail);
                    return;
                }
            }

            if (
                !convId ||
                !conversation ||
                !conversation.members.includes(self)
            ) {
                return;
            }

            avCallDirectionRef.current = "outgoing";
            avCallUiArmedRef.current = convId;

            const isGroupOutbound =
                conversation.kind === "group" &&
                conversation.members.length > 2;

            if (isGroupOutbound) {
                const lifecycle = getGroupMeetLifecycle(
                    groupMeetLifecycleRef.current,
                    convId,
                );
                const rejoinHint =
                    groupMeetRejoinHintRef.current?.spaceUuid === convId
                        ? groupMeetRejoinHintRef.current
                        : rejoinHintFromLifecycle(
                              groupMeetLifecycleRef.current,
                              convId,
                          );
                if (
                    lifecycle?.phase === "leftRejoinable" &&
                    rejoinHint &&
                    rejoinHint.joinedCount > 0 &&
                    orch.getGroupMeetAttemptRole(convId) !== "host"
                ) {
                    rejoinGroupMeetCallRef.current(convId);
                    return;
                }
                groupMeetLifecycleRef.current = markGroupMeetActive(
                    groupMeetLifecycleRef.current,
                    convId,
                );
                orch.markGroupMeetActive(convId);
            }

            setGroupMeetRejoinHint((prev) =>
                prev?.spaceUuid === convId ? null : prev,
            );
            setSelectedConversationId(convId);

            const isGroupSpace =
                conversation.kind === "group" &&
                conversation.members.length > 2;
            const peerAccount =
                !isGroupSpace && conversation.members.length === 2
                    ? (conversation.members.find((m) => m !== self) ?? null)
                    : null;
            if (peerAccount || isGroupSpace) {
                setActiveCall({
                    callId: "",
                    conversationId: convId,
                    peerAccount:
                        peerAccount ??
                        conversation.members.find((m) => m !== self) ??
                        "",
                    direction: "outgoing",
                    wantVideo: true,
                    wantAudio: true,
                    startedAt: Date.now(),
                    status: "ringing",
                    source: "av-call",
                    lastFrame: "Starting…",
                    callKind: isGroupSpace ? "group" : "dm",
                    groupParticipants: isGroupSpace
                        ? buildGroupMeetParticipants(
                              conversation.members,
                              self,
                              presenceByAccountRef.current,
                              {},
                              "ensuring",
                          )
                        : undefined,
                });
            }

            if (
                conversation.kind === "dm" &&
                conversation.members.length === 2
            ) {
                orch.ensureDmAvCallSession(convId, conversation.members);
                return;
            }

            if (
                conversation.kind === "group" &&
                conversation.members.length > 2
            ) {
                orch.ensureGroupAvCallSession(convId, conversation.members, {
                    hostFreshStart: true,
                });
            }
        })();
    };
}

export type StartMockCallDeps = {
    selectedConversationId: string | undefined;
    selfRef: MutableRefObject<string | null>;
    conversationsRef: MutableRefObject<ConversationSnapshot[]>;
    setActiveCall: SetActiveCall;
};

export function createStartMockCall(deps: StartMockCallDeps) {
    const { selectedConversationId, selfRef, conversationsRef, setActiveCall } =
        deps;

    return () => {
        const convId = selectedConversationId;
        const self = selfRef.current;
        if (!convId || !self) return;

        const conversation = conversationsRef.current.find(
            (c) => c.conversationId === convId,
        );
        if (
            !conversation ||
            conversation.kind !== "dm" ||
            conversation.members.length !== 2 ||
            !conversation.members.includes(self)
        ) {
            return;
        }

        const peerAccount = conversation.members.find((m) => m !== self);
        if (!peerAccount) return;

        setActiveCall({
            callId: `mock-${crypto.randomUUID()}`,
            conversationId: convId,
            peerAccount,
            direction: "outgoing",
            wantVideo: true,
            wantAudio: true,
            startedAt: Date.now(),
            status: "ringing",
            source: "mock",
            lastFrame: "Mock outgoing call preview",
        });
    };
}
