import {
    parseChatDataWireEnvelope,
    serializeChatDataWireEnvelope,
    type ChatDataMessageAckEnvelope,
    type ChatDataMessageEnvelope,
    type ChatHistorySyncEnvelope,
} from "../lib/chat-data-envelope";
import { chatDataLog, shortSpaceId } from "../lib/chat-data-debug";
import { recordThreadLifecycle } from "../lib/thread-lifecycle";
import type { IceServerConfig } from "../lib/protocol";
import { RealtimeClient } from "../lib/realtime-client";
import { loadPendingMessages } from "../lib/pending-message-store";
import { spaceUuidFromPslackConversationId } from "../lib/space-bridge";
import {
    createChatTransportStack,
    type ChatTransportStack,
} from "./stack";
import type { EnsureReason } from "./types";

export type ChatTransportBridgeDeps = {
    getRealtime: () => RealtimeClient | null;
    /** Opens a dedicated second x-webrtc-sig socket for an extra pair session. */
    createAuxiliaryRealtime?: () => RealtimeClient;
    getSelf: () => string | null;
    getChainId: () => string | null;
    getIceServers: () => IceServerConfig[] | null;
    onInboundMessage: (envelope: ChatDataMessageEnvelope) => void;
    onInboundHistorySync: (envelope: ChatHistorySyncEnvelope) => void;
    onMessageAck: (
        spaceUuid: string,
        envelope: ChatDataMessageAckEnvelope,
    ) => void;
    onPeerUsable: (remoteAccount: string) => void;
    onSessionInvite: (spaceUuid: string) => void;
};

/**
 * v2 chat-data transport — one PC per remote contact (replaces the
 * legacy Space-run orchestrator stack).
 */
export class ChatTransportBridge {
    private stack: ChatTransportStack | null = null;

    private auxiliaryRealtime: RealtimeClient | null = null;

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
            auxiliaryRealtimeClient: this.ensureAuxiliaryRealtime() ?? undefined,
            iceServers: this.deps.getIceServers(),
            onInboundBytes: (remote, bytes) => {
                this.handleInboundWire(
                    remote,
                    new TextDecoder().decode(bytes),
                );
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
            this.deps.onInboundMessage({
                t: "chatMessage",
                spaceUuid: envelope.spaceUuid,
                from: envelope.from,
                body: envelope.body,
                sendTimestamp: envelope.sendTimestamp,
                clientMsgId: envelope.clientMsgId,
            });
        });

        this.stack.messaging.onRecipientDelivered((msgId, recipient, conversationId) => {
            this.recordDebug("recipient-delivered", { msgId, recipient });
            const spaceUuid = spaceUuidFromPslackConversationId(conversationId);
            if (!spaceUuid) return;
            this.deps.onMessageAck(spaceUuid, {
                t: "messageAck",
                spaceUuid,
                clientMsgId: msgId,
                from: recipient,
            });
        });

        this.stack.peerRegistry.on("usable", (remote) => {
            recordThreadLifecycle("webrtc-usable", { remote });
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
            void this.stack.peerRegistry.ensure(remote, reason);
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
        this.closeAuxiliaryRealtime();
    }

    /** Drop stack + aux without blocking future ensures (in-chat e2e prep). */
    dropTransportStack(): void {
        this.disposeStack();
    }

    /** Drop the live stack on shell navigation without losing bridge/outbox wiring. */
    dropStackForNavigation(): void {
        this.suspended = true;
        this.dropTransportStack();
    }

    private ensureAuxiliaryRealtime(): RealtimeClient | null {
        if (!this.deps.createAuxiliaryRealtime) return null;
        if (!this.auxiliaryRealtime) {
            this.auxiliaryRealtime = this.deps.createAuxiliaryRealtime();
            this.auxiliaryRealtime.connect();
        }
        return this.auxiliaryRealtime;
    }

    private closeAuxiliaryRealtime(): void {
        this.auxiliaryRealtime?.close();
        this.auxiliaryRealtime = null;
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
            void this.ensurePeer(member, "peer_focus");
        }
    }

    ensurePeer(remote: string, reason: EnsureReason = "message_enqueued"): void {
        if (this.suspended) return;
        if (!this.stack) {
            this.pendingEnsures.set(remote, reason);
            this.start();
            return;
        }
        void this.stack.peerRegistry.ensure(remote, reason);
    }

    onPeerOnline(account: string): void {
        this.ensurePeer(account, "presence_online");
    }

    onPeerOffline(_account: string): void {
        /* v2: no per-Space teardown on offline; peer TTL handles idle dispose. */
    }

    sendChatMessage(
        _spaceUuid: string,
        envelope: ChatDataMessageEnvelope,
    ): boolean {
        const recipient = envelope.from === this.deps.getSelf()
            ? undefined
            : undefined;
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
        return this.stack.peerRegistry.send(remote, bytes).ok;
    }

    releaseIdleTransport(_spaceUuid: string): void {
        /* v2: peer TTL + LRU in PeerTransportRegistry; no per-Space release. */
    }

    releaseIdlePeer(remote: string): void {
        this.stack?.peerRegistry.dispose(remote, "idle_release");
    }

    touchPeer(remote: string): void {
        this.stack?.peerRegistry.touch(remote);
    }

    get messaging() {
        return this.stack?.messaging ?? null;
    }

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
        const svc = this.stack?.messaging as
            | { handleWireFromRemote?: (remote: string, raw: string) => void }
            | undefined;
        svc?.handleWireFromRemote?.(remote, raw);
    }

    /** No-op — v2 stack re-joins pairs on welcome via L2. */
    invalidateJoinStateForWelcomeReconnect(): void {
        chatDataLog("welcome reconnect: v2 pair re-join", {});
    }

    /** No-op — v2 keeps usable PCs on welcome. */
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
                __chatTransportV2Debug?: Record<string, unknown>;
            }
        ).__chatTransportV2Debug = {
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
                    state: bridge.stack?.peerRegistry.getState(remote) ?? "absent",
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
            events: () => [...bridge.debugEvents],
            started: () => bridge.stack != null,
            ensurePeers: (remotes: string[]) => {
                for (const remote of remotes) {
                    bridge.ensurePeer(remote, "peer_focus");
                    bridge.stack?.peerRegistry.kickNegotiation(remote);
                }
            },
            kickPeers: (remotes: string[]) => {
                for (const remote of remotes) {
                    bridge.stack?.peerRegistry.kickNegotiation(remote);
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
