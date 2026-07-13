import type { InboundMessageAcceptance } from "../lib/inbound-message-acceptance";
import type { IceServerConfig } from "../lib/protocol";
import type { EnsureReason } from "./types";

import { chatDataLog, shortSpaceId } from "../lib/chat-data-debug";
import {
    type ChatDataMessageAckEnvelope,
    type ChatDataMessageEnvelope,
    type ChatHistorySyncEnvelope,
    parseChatDataWireEnvelope,
    serializeChatDataWireEnvelope,
} from "../lib/chat-data-envelope";
import {
    type InboundAcceptanceRecord,
    clearInboundAcceptanceQueue,
    dequeueInboundAcceptance,
    enqueueInboundAcceptance,
} from "../lib/inbound-acceptance-queue";
import { loadPendingMessages } from "../lib/pending-message-store";
import { RealtimeClient } from "../lib/realtime-client";
import { spaceUuidFromPslackConversationId } from "../lib/space-bridge";
import { recordThreadLifecycle } from "../lib/thread-lifecycle";
import { type ChatTransportStack, createChatTransportStack } from "./stack";

export type ChatTransportBridgeDeps = {
    getRealtime: () => RealtimeClient | null;
    getSelf: () => string | null;
    getChainId: () => string | null;
    getIceServers: () => IceServerConfig[] | null;
    /** Returns how the inbound message was handled (controls wire ack). */
    onInboundMessage: (
        envelope: ChatDataMessageEnvelope,
    ) => InboundMessageAcceptance;
    onInboundHistorySync: (envelope: ChatHistorySyncEnvelope) => void;
    onMessageAck: (
        spaceUuid: string,
        envelope: ChatDataMessageAckEnvelope,
    ) => void;
    onPeerUsable: (remoteAccount: string) => void;
    onSessionInvite: (spaceUuid: string) => void;
    onSpaceMembershipHint?: (from: string) => void;
    /** When `"offline"`, peer_focus ensure is skipped until presence updates. */
    getRemotePresence?: (account: string) => "online" | "offline" | undefined;
};

/**
 * Chat-data transport — one PC per remote contact (per-peer stack).
 */
export class ChatTransportBridge {
    private stack: ChatTransportStack | null = null;

    private suspended = false;

    private focusedSpace: string | null = null;

    private readonly pushedHistoryTo = new Set<string>();

    private startRetryTimer: ReturnType<typeof setTimeout> | null = null;

    private startRetryCount = 0;

    private pendingEnsures = new Map<string, EnsureReason>();

    private readonly debugEvents: Array<{
        ts: number;
        kind: string;
        detail: Record<string, unknown>;
    }> = [];

    private recordDebug(kind: string, detail: Record<string, unknown>): void {
        this.debugEvents.push({ ts: Date.now(), kind, detail });
        if (this.debugEvents.length > 200) {
            this.debugEvents.splice(0, this.debugEvents.length - 200);
        }
    }

    constructor(private readonly deps: ChatTransportBridgeDeps) {}

    start(): void {
        if (this.stack) return;
        const rt = this.deps.getRealtime();
        const self = this.deps.getSelf();
        const chainId = this.deps.getChainId();
        if (!rt || !self || !chainId) {
            if (this.startRetryTimer) return;
            if (this.startRetryCount >= 120) return;
            this.startRetryCount += 1;
            this.startRetryTimer = globalThis.setTimeout(() => {
                this.startRetryTimer = null;
                this.start();
            }, 250);
            return;
        }
        this.startRetryCount = 0;
        if (this.startRetryTimer) {
            globalThis.clearTimeout(this.startRetryTimer);
            this.startRetryTimer = null;
        }

        this.stack = createChatTransportStack({
            localAccount: self,
            chainId,
            realtimeClient: rt,
            iceServers: this.deps.getIceServers(),
            onInboundBytes: (remote, bytes) => {
                this.handleInboundWire(remote, new TextDecoder().decode(bytes));
            },
            onSpaceMembershipHint: (remote) => {
                this.deps.onSpaceMembershipHint?.(remote);
            },
        });

        this.stack.wireRealtimeHandlers({
            sessionSnapshot: (sessionId) => {
                void sessionId;
            },
        });

        this.stack.messaging.onInbound((envelope) => {
            this.recordDebug("inbound-message", {
                from: envelope.from,
                spaceUuid: envelope.spaceUuid,
                clientMsgId: envelope.clientMsgId,
                bodyLen: envelope.body.length,
            });
            const acceptance = this.deps.onInboundMessage({
                t: "chatMessage",
                spaceUuid: envelope.spaceUuid,
                from: envelope.from,
                body: envelope.body,
                sendTimestamp: envelope.sendTimestamp,
                clientMsgId: envelope.clientMsgId,
            });
            if (acceptance === "accepted") {
                this.stack?.messaging.acknowledgeInbound(
                    envelope.remote,
                    envelope.spaceUuid,
                    envelope.clientMsgId,
                );
            } else if (acceptance === "deferred_contacts") {
                const chainId = this.deps.getChainId();
                const self = this.deps.getSelf();
                if (chainId && self) {
                    enqueueInboundAcceptance(chainId, self, {
                        remote: envelope.remote,
                        spaceUuid: envelope.spaceUuid,
                        clientMsgId: envelope.clientMsgId,
                        from: envelope.from,
                        body: envelope.body,
                        sendTimestamp: envelope.sendTimestamp,
                        receivedAt: Date.now(),
                    });
                }
                this.recordDebug("inbound-deferred-contacts", {
                    from: envelope.from,
                    remote: envelope.remote,
                    spaceUuid: envelope.spaceUuid,
                    clientMsgId: envelope.clientMsgId,
                });
            } else {
                this.recordDebug("inbound-rejected-no-ack", {
                    from: envelope.from,
                    remote: envelope.remote,
                    spaceUuid: envelope.spaceUuid,
                    clientMsgId: envelope.clientMsgId,
                });
            }
        });

        this.stack.messaging.onRecipientDelivered(
            (msgId, recipient, conversationId) => {
                this.recordDebug("recipient-delivered", { msgId, recipient });
                const spaceUuid =
                    spaceUuidFromPslackConversationId(conversationId);
                if (!spaceUuid) return;
                this.deps.onMessageAck(spaceUuid, {
                    t: "messageAck",
                    spaceUuid,
                    clientMsgId: msgId,
                    from: recipient,
                });
            },
        );

        this.stack.peerRegistry.on("usable", (remote) => {
            recordThreadLifecycle("webrtc-usable", { remote });
            if (this.pendingSpaceHints.delete(remote)) {
                this.sendSpaceMembershipHint(remote);
            }
            this.deps.onPeerUsable(remote);
            if (!this.pushedHistoryTo.has(remote)) {
                this.pushedHistoryTo.add(remote);
            }
        });

        this.stack.peerRegistry.on("suspected_dead", (remote) => {
            recordThreadLifecycle("webrtc-suspected-dead", { remote });
        });

        this.stack.peerRegistry.on("disposed", (remote) => {
            recordThreadLifecycle("webrtc-disposed", { remote });
        });

        this.stack.messaging.hydrateFromStorage();

        this.stack.messaging.onStatusChange((msgId, status) => {
            this.recordDebug("message-status", { msgId, status });
        });

        this.installTransportDebugGlobal();

        const toEnsure = [...this.pendingEnsures.entries()];
        this.pendingEnsures.clear();
        for (const [remote, reason] of toEnsure) {
            void this.stack.peerLifecycle.ensure(remote, reason);
        }

        this.rehydratePendingOutbox();
    }

    dispose(): void {
        this.disposeStack();
        this.pushedHistoryTo.clear();
        this.startRetryCount = 0;
        if (this.startRetryTimer) {
            globalThis.clearTimeout(this.startRetryTimer);
            this.startRetryTimer = null;
        }
    }

    private disposeStack(): void {
        this.stack?.dispose();
        this.stack = null;
    }

    /** Drop stack without blocking future ensures (in-chat e2e prep). */
    dropTransportStack(): void {
        this.disposeStack();
    }

    /** Drop the live stack on shell navigation without losing bridge/outbox wiring. */
    dropStackForNavigation(): void {
        this.suspended = true;
        this.dropTransportStack();
    }

    suspendForNavigation(): void {
        this.suspended = true;
    }

    private rehydratePendingOutbox(): void {
        this.stack?.messaging.hydrateFromStorage();
        const chainId = this.deps.getChainId();
        const self = this.deps.getSelf();
        if (!this.stack || !chainId || !self) return;
        for (const row of loadPendingMessages(chainId, self)) {
            if (row.status !== "pending") continue;
            for (const recipient of row.recipients) {
                if (!row.deliveredTo.includes(recipient)) {
                    void this.ensurePeer(recipient, "message_enqueued");
                }
            }
        }
    }

    resumeAfterNavigation(): void {
        this.suspended = false;
        this.start();
        this.rehydratePendingOutbox();
    }

    isNavigationSuspended(): boolean {
        return this.suspended;
    }

    setFocusedSpace(spaceUuid: string | null | undefined): void {
        this.focusedSpace = spaceUuid ?? null;
    }

    getFocusedSpace(): string | undefined {
        return this.focusedSpace ?? undefined;
    }

    /** Legacy name — ensures pair transport to every remote member. */
    ensureChatDataSession(
        _spaceUuid: string,
        members: readonly string[],
    ): void {
        if (this.suspended) return;
        const self = this.deps.getSelf();
        if (!self || !this.stack) return;
        for (const member of members) {
            if (member === self) continue;
            if (this.deps.getRemotePresence?.(member) === "offline") {
                continue;
            }
            void this.ensurePeer(member, "peer_focus");
        }
    }

    ensurePeer(
        remote: string,
        reason: EnsureReason = "message_enqueued",
    ): void {
        if (this.suspended) return;
        if (
            (reason === "peer_focus" || reason === "roster_kick") &&
            this.deps.getRemotePresence?.(remote) === "offline"
        ) {
            return;
        }
        if (!this.stack) {
            this.pendingEnsures.set(remote, reason);
            this.start();
            return;
        }
        void this.stack.deliveryFabric.ensurePeer(remote, reason);
    }

    onPeerOnline(account: string): void {
        this.stack?.deliveryFabric.notifyRemoteReachable(
            account,
            "presence_online",
        );
    }

    /** Flush deferred inbound acks after contacts load and re-apply messages. */
    flushDeferredInboundAcceptance(
        reapply: (record: InboundAcceptanceRecord) => InboundMessageAcceptance,
    ): void {
        const chainId = this.deps.getChainId();
        const self = this.deps.getSelf();
        if (!chainId || !self || !this.stack) return;

        const pending = clearInboundAcceptanceQueue(chainId, self);
        for (const record of pending) {
            const acceptance = reapply(record);
            if (acceptance === "accepted") {
                this.stack.messaging.acknowledgeInbound(
                    record.remote,
                    record.spaceUuid,
                    record.clientMsgId,
                );
            } else if (acceptance === "deferred_contacts") {
                enqueueInboundAcceptance(chainId, self, record);
            } else {
                dequeueInboundAcceptance(
                    chainId,
                    self,
                    record.remote,
                    record.spaceUuid,
                    record.clientMsgId,
                );
            }
        }
    }

    onPeerOffline(_account: string): void {
        /* No per-Space teardown on offline; peer TTL handles idle dispose. */
    }

    sendChatMessage(
        _spaceUuid: string,
        envelope: ChatDataMessageEnvelope,
    ): boolean {
        const recipient =
            envelope.from === this.deps.getSelf() ? undefined : undefined;
        void recipient;
        void envelope;
        return false;
    }

    sendHistorySync(
        _spaceUuid: string,
        peerAccount: string,
        envelope: ChatHistorySyncEnvelope,
    ): boolean {
        return this.sendWire(peerAccount, envelope);
    }

    sendGroupHistorySync(
        _spaceUuid: string,
        peerAccount: string,
        envelope: ChatHistorySyncEnvelope,
    ): boolean {
        return this.sendWire(peerAccount, envelope);
    }

    private sendWire(
        remote: string,
        envelope: ChatHistorySyncEnvelope,
    ): boolean {
        if (!this.stack) return false;
        const bytes = new TextEncoder().encode(
            serializeChatDataWireEnvelope(envelope),
        );
        return this.stack.deliveryFabric.sendPeerBytes(remote, bytes).ok;
    }

    /** Ask online peers to reload sidebar spaces after group membership changes. */
    sendSpaceMembershipHint(remote: string): boolean {
        if (!this.stack) return false;
        const bytes = new TextEncoder().encode(
            serializeChatDataWireEnvelope({ t: "spaceMembershipHint" }),
        );
        return this.stack.deliveryFabric.sendPeerBytes(remote, bytes).ok;
    }

    notifySpaceMembershipHint(remoteAccounts: readonly string[]): void {
        if (this.suspended) return;
        const self = this.deps.getSelf();
        if (!self) return;
        for (const remote of remoteAccounts) {
            if (remote === self) continue;
            void this.ensurePeer(remote, "manual");
            if (!this.sendSpaceMembershipHint(remote)) {
                this.pendingSpaceHints.add(remote);
            }
        }
    }

    private readonly pendingSpaceHints = new Set<string>();

    releaseIdleTransport(_spaceUuid: string): void {
        /* Peer TTL + LRU in PeerTransportRegistry; no per-Space release. */
    }

    releaseIdlePeer(remote: string): void {
        this.stack?.deliveryFabric.disposePeer(remote, "idle_release");
    }

    touchPeer(remote: string): void {
        this.stack?.deliveryFabric.touchPeer(remote);
    }

    get messaging() {
        return this.stack?.messaging ?? null;
    }

    get deliveryFabric() {
        return this.stack?.deliveryFabric ?? null;
    }

    get peerLifecycle() {
        return this.stack?.peerLifecycle ?? null;
    }

    /**
     * @deprecated Prefer {@link deliveryFabric} for app ensure/send/media.
     * Retained for debug globals and transitional Meet wiring.
     */
    get peerRegistry() {
        return this.stack?.peerRegistry ?? null;
    }

    handleInboundWire(remote: string, raw: string): void {
        const parsed = parseChatDataWireEnvelope(raw);
        if (!parsed) return;
        if (parsed.t === "chatHistorySync") {
            this.deps.onInboundHistorySync(parsed);
            return;
        }
        if (parsed.t === "spaceMembershipHint") {
            this.deps.onSpaceMembershipHint?.(remote);
            return;
        }
        const svc = this.stack?.messaging as
            | { handleWireFromRemote?: (remote: string, raw: string) => void }
            | undefined;
        svc?.handleWireFromRemote?.(remote, raw);
    }

    /** No-op — stack re-joins pairs on welcome via L2. */
    invalidateJoinStateForWelcomeReconnect(): void {
        chatDataLog("welcome reconnect: pair re-join", {});
    }

    /** No-op — keeps usable PCs on welcome. */
    reconcileAfterReconnect(): void {
        const self = this.deps.getSelf();
        if (!self) return;
        this.stack?.messaging.hydrateFromStorage();
    }

    get signaling() {
        return this.stack?.signaling ?? null;
    }

    installTransportDebugGlobal(): void {
        if (typeof globalThis === "undefined") return;
        const bridge = this;
        (
            globalThis as typeof globalThis & {
                __chatTransportDebug?: Record<string, unknown>;
            }
        ).__chatTransportDebug = {
            peerState: (remote: string) =>
                bridge.stack?.peerRegistry.getState(remote) ?? "absent",
            snapshot: (remotes: string[]) => {
                const churn =
                    typeof window !== "undefined"
                        ? (
                              window as Window & {
                                  __chatChurnState?: () => Record<
                                      string,
                                      unknown
                                  >;
                              }
                          ).__chatChurnState?.()
                        : null;
                const peers = remotes.map((remote) => ({
                    remote,
                    state:
                        bridge.stack?.peerRegistry.getState(remote) ?? "absent",
                }));
                return {
                    started: bridge.stack != null,
                    suspended: bridge.suspended,
                    focusedSpace: bridge.focusedSpace,
                    churn,
                    peers,
                };
            },
            deliverySnapshot: () => {
                const chainId = bridge.deps.getChainId();
                const self = bridge.deps.getSelf();
                if (!chainId || !self) return [];
                return loadPendingMessages(chainId, self).map((row) => ({
                    clientMsgId: row.clientMsgId,
                    bodyPreview: row.body.slice(0, 48),
                    recipients: row.recipients,
                    deliveredTo: row.deliveredTo,
                    status: bridge.stack?.messaging.getStatus(row.clientMsgId),
                    pendingCount: bridge.stack?.messaging.getPendingCount(
                        row.clientMsgId,
                    ),
                }));
            },
            getOutbox: () => {
                const chainId = bridge.deps.getChainId();
                const self = bridge.deps.getSelf();
                if (!chainId || !self) return [];
                return loadPendingMessages(chainId, self);
            },
            routingSnapshot: () => {
                const chainId = bridge.deps.getChainId();
                const self = bridge.deps.getSelf();
                if (!chainId || !self) return null;
                const churn =
                    typeof window !== "undefined"
                        ? (
                              window as Window & {
                                  __chatChurnState?: () => Record<
                                      string,
                                      unknown
                                  >;
                              }
                          ).__chatChurnState?.()
                        : null;
                const rows = loadPendingMessages(chainId, self).map((row) => ({
                    clientMsgId: row.clientMsgId,
                    bodyPreview: row.body.slice(0, 48),
                    conversationId: row.conversationId,
                    recipientCount: row.recipients.length,
                    recipients: row.recipients,
                    status: row.status,
                }));
                return {
                    selectedConversationId:
                        churn?.selectedConversationId ?? null,
                    selectedConversationKind:
                        churn?.selectedConversationKind ?? null,
                    composePendingDmPeer: churn?.composePendingDmPeer ?? null,
                    pendingRows: rows,
                };
            },
            getMessageStatus: (msgId: string) =>
                bridge.stack?.messaging.getStatus(msgId) ?? "UNKNOWN",
            kickCounts: () => bridge.stack?.peerRegistry.getKickCounts() ?? {},
            resetKickCounts: () => {
                bridge.stack?.peerRegistry.resetKickCounts();
            },
            events: () => [...bridge.debugEvents],
            started: () => bridge.stack != null,
            ensurePeers: (remotes: string[]) => {
                for (const remote of remotes) {
                    bridge.ensurePeer(remote, "peer_focus");
                }
            },
            kickPeers: (remotes: string[]) => {
                for (const remote of remotes) {
                    bridge.stack?.notifyRemoteReachable(
                        remote,
                        "presence_online",
                    );
                }
            },
        };
    }

    installDebugGlobal(): void {
        this.installTransportDebugGlobal();
        if (typeof globalThis === "undefined") return;
        const bridge = this;
        (
            globalThis as typeof globalThis & {
                __chatMessagingDebug?: Record<string, unknown>;
            }
        ).__chatMessagingDebug = {
            getOutbox: () => {
                const chainId = bridge.deps.getChainId();
                const self = bridge.deps.getSelf();
                if (!chainId || !self) return [];
                return loadPendingMessages(chainId, self);
            },
            getPeerMap: () => {
                const registry = bridge.stack?.peerRegistry;
                if (!registry) return {};
                return {
                    note: "Use peerRegistry.getState(remote) per contact",
                };
            },
            getMessaging: () => bridge.stack?.messaging ?? null,
            getMessageStatus: (msgId: string) =>
                bridge.stack?.messaging.getStatus(msgId) ?? "UNKNOWN",
            events: () => [...bridge.debugEvents],
        };
    }
}

export function wireInboundBytesToBridge(
    bridge: ChatTransportBridge,
): (remote: string, bytes: Uint8Array) => void {
    return (remote, bytes) => {
        const raw = new TextDecoder().decode(bytes);
        bridge.handleInboundWire(remote, raw);
    };
}
