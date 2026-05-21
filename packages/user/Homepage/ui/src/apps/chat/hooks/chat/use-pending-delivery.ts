import type { ChatDataSessionOrchestrator } from "../../lib/chat-data-session-orchestrator";
import { shouldThrottleBackgroundDmEnsure } from "../../lib/chat-data-idle-release";
import { chatDataLog, shortSpaceId } from "../../lib/chat-data-debug";
import {
    pendingSkipLogKey,
    shouldLogPendingSkip,
} from "../../lib/pending-delivery-coalesce";
import { isDeliveryOpenPeer } from "../../lib/delivery-open-peers";
import {
    planPendingFlush,
    type FlushConversation,
    type FlushPendingMessage,
    type FlushPlanInputs,
} from "../../lib/pending-message-flush";

function canonicalDmMembers(
    self: string,
    recipients: readonly string[],
): [string, string] | null {
    if (recipients.length !== 1) return null;
    const peer = recipients[0]!;
    return self.localeCompare(peer) < 0
        ? [self, peer]
        : [peer, self];
}

export type PendingDeliveryExecutorDeps = {
    getSelf: () => string | null;
    getChainId: () => string | null;
    getPendingMessages: () => FlushPendingMessage[];
    getConversations: () => FlushConversation[];
    getPresenceByAccount: () => Readonly<Record<string, string>>;
    isRealtimeReady: () => boolean;
    getInFlightKeys: () => Set<string>;
    getOrchestrator: () => ChatDataSessionOrchestrator | null;
    /** Prefer orchestrator focus policy (`getFocusedSpace`). */
    getFocusedSpace?: () => string | undefined;
};

/** Execute a pending-flush plan (pure side-effect runner for tests and hooks). */
export function executePendingFlushPlan(
    deps: PendingDeliveryExecutorDeps,
    options?: { forceRecipients?: ReadonlySet<string> },
): void {
    const self = deps.getSelf();
    if (!self) return;

    const orchestrator = deps.getOrchestrator();
    if (orchestrator?.isNavigationSuspended()) {
        return;
    }
    const inputs: FlushPlanInputs = {
        self,
        chainId: deps.getChainId(),
        pendingMessages: deps.getPendingMessages(),
        conversations: deps.getConversations(),
        presenceByAccount: deps.getPresenceByAccount(),
        realtimeReady: deps.isRealtimeReady(),
        inFlightKeys: deps.getInFlightKeys(),
        forceRecipients: options?.forceRecipients,
        getDmSnapshot: (spaceId) => orchestrator?.getSnapshot(spaceId),
        getGroupMeshPeerReady: (spaceId, recipient) =>
            orchestrator?.groupMeshPeerReady(spaceId, recipient) ?? false,
        isDeliveryOpenPeer,
        canonicalDmMembers,
    };

    const plan = planPendingFlush(inputs);
    const inFlight = deps.getInFlightKeys();

    const focusedSpaceId = deps.getFocusedSpace?.() ?? undefined;
    const conversations = deps.getConversations();
    const forceRecipients = options?.forceRecipients;

    for (const action of plan.actions) {
        switch (action.kind) {
            case "ensureDm":
            case "ensureGroup": {
                const run = orchestrator?.getRun(action.spaceUuid);
                const dmPeer =
                    run?.kind === "dm" ? run.peerAccount : undefined;
                const bypassBackgroundThrottle =
                    action.kind === "ensureDm" &&
                    dmPeer != null &&
                    forceRecipients?.has(dmPeer) === true;
                if (
                    action.kind === "ensureDm" &&
                    run?.kind === "dm" &&
                    !bypassBackgroundThrottle &&
                    shouldThrottleBackgroundDmEnsure({
                        selectedConversationId: focusedSpaceId,
                        ensureSpaceUuid: action.spaceUuid,
                        conversations,
                        lastEnsureMs: run.lastMeshNudgeMs,
                    })
                ) {
                    break;
                }
                if (action.kind === "ensureDm" && run?.kind === "dm") {
                    run.lastMeshNudgeMs = Date.now();
                }
                orchestrator?.ensureChatDataSession(
                    action.spaceUuid,
                    action.members,
                );
                break;
            }
            case "skip": {
                const key = pendingSkipLogKey(
                    action.reason,
                    action.spaceUuid,
                    action.recipient,
                );
                if (!shouldLogPendingSkip(key)) break;
                if (action.reason === "data-channel-not-ready") {
                    chatDataLog("flush pending: data channel not ready", {
                        space: action.spaceUuid
                            ? shortSpaceId(action.spaceUuid)
                            : undefined,
                        phase: action.phase,
                        sessionId: action.sessionId,
                    });
                } else if (action.reason === "group-mesh-peer-not-ready") {
                    chatDataLog("flush pending: group mesh peer not ready", {
                        space: action.spaceUuid
                            ? shortSpaceId(action.spaceUuid)
                            : undefined,
                        recipient: action.recipient,
                    });
                }
                break;
            }
            case "sendDm": {
                inFlight.add(action.flightKey);
                globalThis.setTimeout(() => {
                    inFlight.delete(action.flightKey);
                }, 5_000);
                const sent =
                    orchestrator?.sendChatMessage(
                        action.spaceUuid,
                        action.envelope,
                    ) ?? false;
                chatDataLog(
                    sent
                        ? "DM sent on data channel (awaiting ack)"
                        : "DM sendChatMessage returned false",
                    {
                        space: shortSpaceId(action.spaceUuid),
                        clientMsgId: action.envelope.clientMsgId,
                    },
                );
                if (!sent) {
                    inFlight.delete(action.flightKey);
                }
                break;
            }
            case "sendGroup": {
                inFlight.add(action.flightKey);
                globalThis.setTimeout(() => {
                    inFlight.delete(action.flightKey);
                }, 5_000);
                const sent =
                    orchestrator?.sendGroupChatMessage(
                        action.spaceUuid,
                        action.recipient,
                        action.envelope,
                    ) ?? false;
                chatDataLog(
                    sent
                        ? "group sent on data channel (awaiting ack)"
                        : "group sendGroupChatMessage returned false",
                    {
                        space: shortSpaceId(action.spaceUuid),
                        recipient: action.recipient,
                        clientMsgId: action.envelope.clientMsgId,
                    },
                );
                if (!sent) {
                    inFlight.delete(action.flightKey);
                }
                break;
            }
            default:
                break;
        }
    }
}
