import type { ChatDataMessageEnvelope } from "./chat-data-envelope";
import type { ChatDataSessionSnapshot } from "./chat-data-session-orchestrator";
import { spaceUuidFromPslackConversationId } from "./space-bridge";

export type FlushPendingMessage = {
    clientMsgId: string;
    conversationId: string;
    from: string;
    body: string;
    createdAt: number;
    recipients: readonly string[];
    deliveredTo: readonly string[];
    status: "pending" | "sent" | "failed";
};

export type FlushConversation = {
    conversationId: string;
    kind: "dm" | "group";
    members: readonly string[];
};

export type FlushPlanInputs = {
    self: string;
    chainId: string | null;
    pendingMessages: readonly FlushPendingMessage[];
    conversations: readonly FlushConversation[];
    presenceByAccount: Readonly<Record<string, string>>;
    /** x-webrtc-sig websocket connected and presence snapshot received. */
    realtimeReady: boolean;
    inFlightKeys: ReadonlySet<string>;
    forceRecipients?: ReadonlySet<string>;
    getDmSnapshot: (spaceUuid: string) => ChatDataSessionSnapshot | undefined;
    getGroupMeshPeerReady: (spaceUuid: string, recipient: string) => boolean;
    isDeliveryOpenPeer: (chainId: string, self: string, peer: string) => boolean;
    canonicalDmMembers: (
        self: string,
        recipients: readonly string[],
    ) => readonly string[] | null;
};

export type EnsureDmAction = {
    kind: "ensureDm";
    spaceUuid: string;
    members: readonly string[];
};

export type EnsureGroupAction = {
    kind: "ensureGroup";
    spaceUuid: string;
    members: readonly string[];
};

export type SendDmAction = {
    kind: "sendDm";
    spaceUuid: string;
    recipient: string;
    flightKey: string;
    envelope: ChatDataMessageEnvelope;
    pending: FlushPendingMessage;
};

export type SendGroupAction = {
    kind: "sendGroup";
    spaceUuid: string;
    recipient: string;
    flightKey: string;
    envelope: ChatDataMessageEnvelope;
    pending: FlushPendingMessage;
};

export type SkipReason =
    | "data-channel-not-ready"
    | "group-mesh-peer-not-ready"
    | "delivered"
    | "in-flight"
    | "recipient-offline"
    | "delivery-not-open"
    | "realtime-not-ready";

export type SkippedAction = {
    kind: "skip";
    reason: SkipReason;
    spaceUuid?: string;
    conversationId?: string;
    recipient?: string;
    clientMsgId?: string;
    phase?: string;
    sessionId?: string;
};

export type FlushPlanAction =
    | EnsureDmAction
    | EnsureGroupAction
    | SendDmAction
    | SendGroupAction
    | SkippedAction;

export type FlushPlan = {
    actions: FlushPlanAction[];
};

function flightKey(clientMsgId: string, recipient: string): string {
    return `${clientMsgId}:${recipient}`;
}

function buildEnvelope(
    pending: FlushPendingMessage,
    spaceUuid: string,
    self: string,
): ChatDataMessageEnvelope {
    return {
        t: "chatMessage",
        spaceUuid,
        from: self,
        body: pending.body,
        sendTimestamp: pending.createdAt,
        clientMsgId: pending.clientMsgId,
    };
}

/**
 * Plan C3 — should we attempt a send to `recipient` for `pending` in this
 * flush?
 *
 * - When `forceRecipients` is set (e.g. SM-driven flush after a remote DC
 *   open, or a fresh enqueue), we restrict to that recipient set so the
 *   flush does not blanket-flush every other conversation.
 * - When `transportReady` is true (DM data channel open, or group mesh peer
 *   ready for this recipient), always attempt — covers first-time DMs where
 *   delivery-open has not been recorded yet.
 * - Otherwise (blanket periodic flush with transport down): only retry rows
 *   with partial delivery or known delivery-open peers, so stale pending rows
 *   for never-contacted peers do not wake sessions.
 *
 * Returns `null` to attempt the send, or a `SkipReason` to skip it.
 */
function shouldAttemptRecipient(
    input: FlushPlanInputs,
    pending: FlushPendingMessage,
    recipient: string,
    transportReady: boolean,
): "delivery-not-open" | null {
    if (input.forceRecipients) {
        return input.forceRecipients.has(recipient)
            ? null
            : "delivery-not-open";
    }
    if (transportReady) return null;
    if (pending.deliveredTo.length > 0) return null;
    if (!input.chainId) return null;
    if (input.isDeliveryOpenPeer(input.chainId, input.self, recipient)) {
        return null;
    }
    return "delivery-not-open";
}

/**
 * Compute the side-effect plan for flushing pending messages.
 * Pure; the caller is responsible for executing actions and tracking inFlightKeys.
 */
export function planPendingFlush(input: FlushPlanInputs): FlushPlan {
    const actions: FlushPlanAction[] = [];

    for (const pending of input.pendingMessages) {
        if (pending.status !== "pending") continue;

        const spaceUuid = spaceUuidFromPslackConversationId(
            pending.conversationId,
        );
        const conversation = input.conversations.find(
            (row) => row.conversationId === spaceUuid,
        );

        const isDm =
            conversation?.kind === "dm" ||
            (pending.recipients.length === 1 && spaceUuid.startsWith("space:"));

        if (isDm) {
            const delivered = new Set(pending.deliveredTo);
            const snap = input.getDmSnapshot(spaceUuid);
            const dmTransportReady = snap?.dataChannelReady ?? false;
            const liveRecipients = pending.recipients.filter(
                (recipient) => !delivered.has(recipient),
            );
            const targetableRecipients = liveRecipients.filter(
                (recipient) =>
                    shouldAttemptRecipient(
                        input,
                        pending,
                        recipient,
                        dmTransportReady,
                    ) === null,
            );
            const dmMembers =
                conversation?.members ??
                input.canonicalDmMembers(input.self, pending.recipients);
            if (dmMembers && targetableRecipients.length > 0) {
                actions.push({
                    kind: "ensureDm",
                    spaceUuid,
                    members: dmMembers,
                });
            }
            if (!dmTransportReady) {
                actions.push({
                    kind: "skip",
                    reason: "data-channel-not-ready",
                    spaceUuid,
                    clientMsgId: pending.clientMsgId,
                    phase: snap?.phase,
                    sessionId: snap?.sessionId,
                });
                continue;
            }
            for (const recipient of pending.recipients) {
                if (delivered.has(recipient)) {
                    actions.push({
                        kind: "skip",
                        reason: "delivered",
                        spaceUuid,
                        recipient,
                        clientMsgId: pending.clientMsgId,
                    });
                    continue;
                }
                const skipReason = shouldAttemptRecipient(
                    input,
                    pending,
                    recipient,
                    dmTransportReady,
                );
                if (skipReason) {
                    actions.push({
                        kind: "skip",
                        reason: skipReason,
                        spaceUuid,
                        recipient,
                        clientMsgId: pending.clientMsgId,
                    });
                    continue;
                }
                const key = flightKey(pending.clientMsgId, recipient);
                if (input.inFlightKeys.has(key)) {
                    actions.push({
                        kind: "skip",
                        reason: "in-flight",
                        spaceUuid,
                        recipient,
                        clientMsgId: pending.clientMsgId,
                    });
                    continue;
                }
                actions.push({
                    kind: "sendDm",
                    spaceUuid,
                    recipient,
                    flightKey: key,
                    envelope: buildEnvelope(pending, spaceUuid, input.self),
                    pending,
                });
            }
            continue;
        }

        const isGroup =
            conversation?.kind === "group" &&
            (conversation.members.length > 2 ||
                pending.recipients.length > 1);

        if (isGroup && conversation) {
            const delivered = new Set(pending.deliveredTo);
            const liveRecipients = pending.recipients.filter(
                (recipient) => !delivered.has(recipient),
            );
            const targetableRecipients = liveRecipients.filter(
                (recipient) =>
                    shouldAttemptRecipient(
                        input,
                        pending,
                        recipient,
                        input.getGroupMeshPeerReady(spaceUuid, recipient),
                    ) === null,
            );
            if (targetableRecipients.length > 0) {
                actions.push({
                    kind: "ensureGroup",
                    spaceUuid,
                    members: conversation.members,
                });
            }
            for (const recipient of pending.recipients) {
                if (delivered.has(recipient)) {
                    actions.push({
                        kind: "skip",
                        reason: "delivered",
                        spaceUuid,
                        recipient,
                        clientMsgId: pending.clientMsgId,
                    });
                    continue;
                }
                const skipReason = shouldAttemptRecipient(
                    input,
                    pending,
                    recipient,
                    input.getGroupMeshPeerReady(spaceUuid, recipient),
                );
                if (skipReason) {
                    actions.push({
                        kind: "skip",
                        reason: skipReason,
                        spaceUuid,
                        recipient,
                        clientMsgId: pending.clientMsgId,
                    });
                    continue;
                }
                if (input.presenceByAccount[recipient] !== "online") {
                    actions.push({
                        kind: "skip",
                        reason: "recipient-offline",
                        spaceUuid,
                        recipient,
                        clientMsgId: pending.clientMsgId,
                    });
                    continue;
                }
                if (!input.getGroupMeshPeerReady(spaceUuid, recipient)) {
                    actions.push({
                        kind: "skip",
                        reason: "group-mesh-peer-not-ready",
                        spaceUuid,
                        recipient,
                        clientMsgId: pending.clientMsgId,
                    });
                    continue;
                }
                const key = flightKey(pending.clientMsgId, recipient);
                if (input.inFlightKeys.has(key)) {
                    actions.push({
                        kind: "skip",
                        reason: "in-flight",
                        spaceUuid,
                        recipient,
                        clientMsgId: pending.clientMsgId,
                    });
                    continue;
                }
                actions.push({
                    kind: "sendGroup",
                    spaceUuid,
                    recipient,
                    flightKey: key,
                    envelope: buildEnvelope(pending, spaceUuid, input.self),
                    pending,
                });
            }
            continue;
        }

        actions.push({
            kind: "skip",
            reason: input.realtimeReady
                ? "data-channel-not-ready"
                : "realtime-not-ready",
            conversationId: pending.conversationId,
            clientMsgId: pending.clientMsgId,
        });
    }

    return { actions };
}
