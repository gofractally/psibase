import type { RealtimeTransport } from "./l1-realtime-transport";
import type { PeerTransportRegistry } from "./l3-peer-registry";
import type { PeerLifecycleCoordinator } from "./peer-lifecycle-coordinator";

import { chatDataRecord, shortSpaceId } from "../lib/chat-data-debug";
import {
    type ChatDataMessageAckEnvelope,
    type ChatDataMessageEnvelope,
    parseChatDataWireEnvelope,
    serializeChatDataMessage,
    serializeChatDataWireEnvelope,
} from "../lib/chat-data-envelope";
import { composeTimingLog } from "../lib/dm-compose-timing";
import {
    type PendingAckRecord,
    loadPendingAcks,
    savePendingAcks,
} from "../lib/pending-ack-store";
import {
    type PendingChatMessage,
    loadPendingMessages,
    savePendingMessagesWithQuotaRecovery,
} from "../lib/pending-message-store";
import {
    pslackConversationIdFromSpaceUuid,
    spaceUuidFromPslackConversationId,
} from "../lib/space-bridge";
import { createDeliveryCoordinator } from "./delivery-coordinator";
import { EventBus } from "./event-bus";
import {
    IN_FLIGHT_ACK_WAIT_MS,
    type InboundEnvelope,
    MAX_VALID_ATTEMPTS,
    type MessageStatus,
    type PendingCount,
    type SendGroupRequest,
    type SendRequest,
    type Unsubscribe,
} from "./types";

type MessagingEvents = {
    statusChange: (msgId: string, status: MessageStatus) => void;
    inbound: (envelope: InboundEnvelope) => void;
    recipientDelivered: (
        msgId: string,
        recipient: string,
        conversationId: string,
    ) => void;
};

export interface MessagingService {
    send(req: SendRequest): Promise<{ msgId: string }>;
    sendGroup(req: SendGroupRequest): Promise<{ msgId: string }>;
    getStatus(msgId: string): MessageStatus;
    getPendingCount(msgId: string): PendingCount;
    onStatusChange(
        handler: (msgId: string, status: MessageStatus) => void,
    ): Unsubscribe;
    onInbound(handler: (envelope: InboundEnvelope) => void): Unsubscribe;
    onRecipientDelivered(
        handler: (
            msgId: string,
            recipient: string,
            conversationId: string,
        ) => void,
    ): Unsubscribe;
    hydrateFromStorage(): void;
    /**
     * Focused conversation for flush priority (H28). Remotes with pending
     * rows for this space flush before background remotes.
     */
    setFocusedSpace(spaceUuid: string | null | undefined): void;
    /**
     * Ack an inbound message after the consumer accepted it. Acking on wire
     * parse would prune the sender's outbox even when the recipient drops
     * the message (e.g. contact gate), permanently losing it.
     */
    acknowledgeInbound(
        remote: string,
        spaceUuid: string,
        clientMsgId: string,
    ): void;
}

type InFlightKey = `${string}\0${string}`;
type PendingAckKey = `${string}\0${string}\0${string}`;

type InFlightRow = {
    msgId: string;
    recipient: string;
    envelope: ChatDataMessageEnvelope;
    validAttempt: boolean;
    timer: ReturnType<typeof setTimeout> | null;
};

export type MessagingServiceOptions = {
    localAccount: string;
    chainId: string;
    realtime: RealtimeTransport;
    peerRegistry: PeerTransportRegistry;
    /**
     * Preferred ensure path. When omitted (unit tests), falls back to
     * `peerRegistry.ensure`.
     */
    peerLifecycle?: Pick<PeerLifecycleCoordinator, "ensure">;
    /** Returns true when `account` may receive for `spaceUuid`. */
    isSpaceMember?: (spaceUuid: string, account: string) => boolean;
    now?: () => number;
};

function inFlightKey(msgId: string, recipient: string): InFlightKey {
    return `${msgId}\0${recipient}`;
}

function newClientMsgId(now: number): string {
    return `msg-${now}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createMessagingService(
    opts: MessagingServiceOptions,
): MessagingService {
    const bus = new EventBus<MessagingEvents>();
    const now = opts.now ?? (() => Date.now());
    const ensurePeer = (remote: string) =>
        (opts.peerLifecycle ?? opts.peerRegistry).ensure(
            remote,
            "message_enqueued",
        );

    let rows: PendingChatMessage[] = loadPendingMessages(
        opts.chainId,
        opts.localAccount,
    );
    const persist = () => {
        savePendingMessagesWithQuotaRecovery(
            opts.chainId,
            opts.localAccount,
            rows,
        );
    };
    // ACK-timer bookkeeping only — DeliveryCoordinator legs are SoT for delivery state.
    const inFlight = new Map<InFlightKey, InFlightRow>();
    const pendingAcks = new Map<
        PendingAckKey,
        {
            remote: string;
            ack: ChatDataMessageAckEnvelope;
        }
    >();
    const pendingAckKey = (
        remote: string,
        spaceUuid: string,
        clientMsgId: string,
    ): PendingAckKey =>
        `${remote}\0${spaceUuid}\0${clientMsgId}` as PendingAckKey;
    const persistPendingAcks = () => {
        const records: PendingAckRecord[] = [...pendingAcks.values()].map(
            ({ remote, ack }) => ({ remote, ack }),
        );
        savePendingAcks(opts.chainId, opts.localAccount, records);
    };
    const restorePendingAcks = () => {
        pendingAcks.clear();
        for (const record of loadPendingAcks(opts.chainId, opts.localAccount)) {
            pendingAcks.set(
                pendingAckKey(
                    record.remote,
                    record.ack.spaceUuid,
                    record.ack.clientMsgId,
                ),
                record,
            );
        }
    };
    restorePendingAcks();
    const validAttempts = new Map<InFlightKey, number>();
    const statusByMsg = new Map<string, MessageStatus>();
    /** Normalized focused space; drives flushAll priority ordering. */
    let focusedSpaceUuid: string | null = null;

    const emitStatus = (msgId: string, status: MessageStatus) => {
        statusByMsg.set(msgId, status);
        bus.emit("statusChange", msgId, status);
    };

    const rowStatus = (row: PendingChatMessage): MessageStatus => {
        if (row.status === "failed") return "FAILED";
        const pendingRecipients = row.recipients.filter(
            (r) => !row.deliveredTo.includes(r),
        );
        if (pendingRecipients.length === 0) return "DELIVERED";
        return "PENDING";
    };

    const syncRowStatus = (row: PendingChatMessage) => {
        emitStatus(row.clientMsgId, rowStatus(row));
    };

    const findRow = (msgId: string) =>
        rows.find((r) => r.clientMsgId === msgId) ?? null;

    const sendAck = (
        remote: string,
        ack: ChatDataMessageAckEnvelope,
    ): boolean => {
        const bytes = new TextEncoder().encode(
            serializeChatDataWireEnvelope(ack),
        );
        const result = opts.peerRegistry.send(remote, bytes);
        return result.ok;
    };

    const flushPendingAcks = (remote: string) => {
        let changed = false;
        for (const [key, pending] of [...pendingAcks]) {
            if (pending.remote !== remote) continue;
            if (sendAck(remote, pending.ack)) {
                pendingAcks.delete(key);
                changed = true;
            } else {
                void ensurePeer(remote);
            }
        }
        if (changed) persistPendingAcks();
    };

    const outboxByRemote = (): Map<string, PendingChatMessage[]> => {
        const map = new Map<string, PendingChatMessage[]>();
        for (const row of rows) {
            if (row.status !== "pending") continue;
            for (const recipient of row.recipients) {
                if (row.deliveredTo.includes(recipient)) continue;
                const list = map.get(recipient) ?? [];
                list.push(row);
                map.set(recipient, list);
            }
        }
        return map;
    };

    const clearInFlightTimer = (key: InFlightKey) => {
        const row = inFlight.get(key);
        if (row?.timer) clearTimeout(row.timer);
    };

    const markDelivered = (msgId: string, recipient: string) => {
        const row = findRow(msgId);
        if (!row) return;
        const conversationId = row.conversationId;
        if (!row.deliveredTo.includes(recipient)) {
            row.deliveredTo.push(recipient);
        }
        const key = inFlightKey(msgId, recipient);
        clearInFlightTimer(key);
        inFlight.delete(key);
        deliveryCoordinator.markAcked(msgId, recipient);
        if (row.deliveredTo.length >= row.recipients.length) {
            row.status = "sent";
            rows = rows.filter((r) => r.clientMsgId !== msgId);
        }
        persist();
        syncRowStatus(row);
        bus.emit("recipientDelivered", msgId, recipient, conversationId);
    };

    const markFailed = (msgId: string, recipient: string, reason: string) => {
        const row = findRow(msgId);
        if (!row) return;
        row.status = "failed";
        row.errorReason = reason;
        const key = inFlightKey(msgId, recipient);
        clearInFlightTimer(key);
        inFlight.delete(key);
        persist();
        emitStatus(msgId, "FAILED");
    };

    const scheduleAckWait = (flight: InFlightRow) => {
        const key = inFlightKey(flight.msgId, flight.recipient);
        clearInFlightTimer(key);
        flight.timer = setTimeout(() => {
            handleAckTimeout(flight.msgId, flight.recipient);
        }, IN_FLIGHT_ACK_WAIT_MS);
    };

    const handleAckTimeout = async (msgId: string, recipient: string) => {
        const key = inFlightKey(msgId, recipient);
        const flight = inFlight.get(key);
        if (!flight) return;
        inFlight.delete(key);

        if (flight.validAttempt) {
            const attempts = (validAttempts.get(key) ?? 0) + 1;
            validAttempts.set(key, attempts);
            if (attempts >= MAX_VALID_ATTEMPTS) {
                markFailed(
                    msgId,
                    recipient,
                    `exceeded ${MAX_VALID_ATTEMPTS} valid attempts`,
                );
                return;
            }
        }

        const pingOk = await opts.peerRegistry.ping(recipient);
        // Never dispose Meet-held peers for a single message ACK miss.
        if (!pingOk && !opts.peerRegistry.isMeetHeld(recipient)) {
            opts.peerRegistry.dispose(recipient, "ack_timeout");
        }

        deliveryCoordinator.onAckTimeout(msgId, recipient);
        void flushRemote(recipient);
    };

    const buildEnvelope = (
        row: PendingChatMessage,
        recipient: string,
    ): ChatDataMessageEnvelope => ({
        t: "chatMessage",
        spaceUuid: spaceUuidFromPslackConversationId(row.conversationId),
        from: row.from,
        body: row.body,
        sendTimestamp: row.createdAt,
        clientMsgId: row.clientMsgId,
    });

    const trySendToRecipient = (
        row: PendingChatMessage,
        recipient: string,
    ): { ok: true } | { ok: false; reason: string; retryable?: boolean } => {
        if (row.deliveredTo.includes(recipient)) {
            return { ok: false, reason: "already_delivered", retryable: false };
        }
        const peerState = opts.peerRegistry.getState(recipient);
        const peerUsable = peerState === "usable";
        const recipientOnline = opts.realtime.isRecipientOnline(recipient);
        if (!recipientOnline && !peerUsable) {
            chatDataRecord("pending-flush-skip", {
                msgId: row.clientMsgId,
                recipient,
                peerState,
                recipientOnline,
                bodyPreview: row.body.slice(0, 48),
            });
            return {
                ok: false,
                reason: "recipient_unreachable",
                retryable: true,
            };
        }

        const key = inFlightKey(row.clientMsgId, recipient);
        if (inFlight.has(key)) {
            chatDataRecord("pending-flush-in-flight", {
                msgId: row.clientMsgId,
                recipient,
            });
            return { ok: false, reason: "in_flight", retryable: true };
        }

        const spaceUuid = spaceUuidFromPslackConversationId(row.conversationId);
        if (opts.isSpaceMember && !opts.isSpaceMember(spaceUuid, recipient)) {
            return {
                ok: false,
                reason: "recipient not a space member",
                retryable: false,
            };
        }

        const envelope = buildEnvelope(row, recipient);
        const bytes = new TextEncoder().encode(
            serializeChatDataMessage(envelope),
        );
        const result = opts.peerRegistry.send(recipient, bytes);
        if (!result.ok) {
            void ensurePeer(recipient);
            return { ok: false, reason: result.reason, retryable: true };
        }

        const validAttempt = opts.realtime.isRecipientOnline(recipient);
        const flight: InFlightRow = {
            msgId: row.clientMsgId,
            recipient,
            envelope,
            validAttempt,
            timer: null,
        };
        inFlight.set(key, flight);
        scheduleAckWait(flight);
        return { ok: true };
    };

    const deliveryCoordinator = createDeliveryCoordinator({
        ensurePeer: (remote) => ensurePeer(remote),
        trySend: (msgId, recipient) => {
            const row = findRow(msgId);
            if (!row) {
                return {
                    ok: false,
                    reason: "row missing",
                    retryable: false,
                };
            }
            const memberCheck = opts.isSpaceMember
                ? opts.isSpaceMember(
                      spaceUuidFromPslackConversationId(row.conversationId),
                      recipient,
                  )
                : true;
            if (!memberCheck) {
                return {
                    ok: false,
                    reason: "recipient not a space member",
                    retryable: false,
                };
            }
            return trySendToRecipient(row, recipient);
        },
        onAcked: () => {},
        onFailed: (msgId, recipient, reason) => {
            markFailed(msgId, recipient, reason);
        },
    });

    const flushRemote = async (remote: string) => {
        const pending = outboxByRemote().get(remote) ?? [];
        chatDataRecord("pending-flush-remote", {
            remote,
            peerState: opts.peerRegistry.getState(remote),
            queued: pending.length,
        });
        for (const row of pending) {
            deliveryCoordinator.enqueue(row.clientMsgId, remote);
        }
        await deliveryCoordinator.flushRemote(remote);
    };

    const flushAll = () => {
        const byRemote = outboxByRemote();
        const remotes = [...byRemote.keys()];
        if (!focusedSpaceUuid) {
            for (const remote of remotes) {
                void flushRemote(remote);
            }
            return;
        }
        const focused: string[] = [];
        const others: string[] = [];
        for (const remote of remotes) {
            const rows = byRemote.get(remote) ?? [];
            const inFocused = rows.some(
                (row) =>
                    spaceUuidFromPslackConversationId(row.conversationId) ===
                    focusedSpaceUuid,
            );
            if (inFocused) focused.push(remote);
            else others.push(remote);
        }
        for (const remote of [...focused, ...others]) {
            void flushRemote(remote);
        }
    };

    const enqueueRow = (row: PendingChatMessage) => {
        const ix = rows.findIndex((r) => r.clientMsgId === row.clientMsgId);
        if (ix >= 0) {
            rows[ix] = row;
        } else {
            rows.push(row);
        }
        persist();
        syncRowStatus(row);
        for (const recipient of row.recipients) {
            if (row.deliveredTo.includes(recipient)) continue;
            deliveryCoordinator.enqueue(row.clientMsgId, recipient);
            void flushRemote(recipient);
        }
    };

    opts.peerRegistry.on("usable", (remote) => {
        flushPendingAcks(remote);
        void flushRemote(remote);
    });

    opts.peerRegistry.on("suspected_dead", (remote) => {
        for (const [key, flight] of inFlight) {
            if (flight.recipient !== remote) continue;
            clearInFlightTimer(key);
            inFlight.delete(key);
        }
        void flushRemote(remote);
    });

    opts.realtime.on("ready", () => flushAll());
    opts.realtime.on("presence", (account: string, online: boolean) => {
        if (online) void flushRemote(account);
    });

    return {
        async send(req) {
            composeTimingLog("l4-send", {
                kind: "dm",
                spaceId: shortSpaceId(req.spaceUuid),
                recipient: req.recipient,
            });
            // Keep in sync with hook-level pending writes before enqueue.
            rows = loadPendingMessages(opts.chainId, opts.localAccount);
            const msgId = req.clientMsgId ?? newClientMsgId(now());
            const row: PendingChatMessage = {
                clientMsgId: msgId,
                conversationId: pslackConversationIdFromSpaceUuid(
                    req.spaceUuid,
                ),
                from: opts.localAccount,
                body:
                    typeof req.body === "string"
                        ? req.body
                        : JSON.stringify(req.body),
                createdAt: now(),
                recipients: [req.recipient],
                deliveredTo: [],
                status: "pending",
                attempts: 0,
            };
            enqueueRow(row);
            return { msgId };
        },

        async sendGroup(req) {
            composeTimingLog("l4-send", {
                kind: "group",
                spaceId: shortSpaceId(req.spaceUuid),
                recipientCount: req.recipients.length,
            });
            rows = loadPendingMessages(opts.chainId, opts.localAccount);
            const msgId = req.clientMsgId ?? newClientMsgId(now());
            const row: PendingChatMessage = {
                clientMsgId: msgId,
                conversationId: pslackConversationIdFromSpaceUuid(
                    req.spaceUuid,
                ),
                from: opts.localAccount,
                body:
                    typeof req.body === "string"
                        ? req.body
                        : JSON.stringify(req.body),
                createdAt: now(),
                recipients: [...req.recipients],
                deliveredTo: [],
                status: "pending",
                attempts: 0,
            };
            enqueueRow(row);
            return { msgId };
        },

        getStatus(msgId) {
            return (
                statusByMsg.get(msgId) ??
                rowStatus(
                    findRow(msgId) ?? {
                        clientMsgId: msgId,
                        conversationId: "",
                        from: opts.localAccount,
                        body: "",
                        createdAt: 0,
                        recipients: [],
                        deliveredTo: [],
                        status: "failed",
                    },
                )
            );
        },

        getPendingCount(msgId) {
            const row = findRow(msgId);
            if (!row) return { delivered: 0, total: 0 };
            const total = row.recipients.length;
            const delivered = row.deliveredTo.length;
            return { delivered, total };
        },

        onStatusChange(handler) {
            return bus.on("statusChange", handler);
        },

        onInbound(handler) {
            return bus.on("inbound", handler);
        },

        onRecipientDelivered(handler) {
            return bus.on("recipientDelivered", handler);
        },

        hydrateFromStorage() {
            rows = loadPendingMessages(opts.chainId, opts.localAccount);
            restorePendingAcks();
            for (const row of rows) {
                syncRowStatus(row);
            }
            flushAll();
            for (const { remote } of pendingAcks.values()) {
                flushPendingAcks(remote);
            }
        },

        setFocusedSpace(spaceUuid) {
            const next =
                typeof spaceUuid === "string" ? spaceUuid.trim() : "";
            focusedSpaceUuid = next.length > 0 ? next : null;
        },

        acknowledgeInbound(
            remote: string,
            spaceUuid: string,
            clientMsgId: string,
        ) {
            const ack: ChatDataMessageAckEnvelope = {
                t: "messageAck",
                spaceUuid,
                clientMsgId,
                from: opts.localAccount,
            };
            if (sendAck(remote, ack)) return;
            pendingAcks.set(pendingAckKey(remote, spaceUuid, clientMsgId), {
                remote,
                ack,
            });
            persistPendingAcks();
            void ensurePeer(remote);
        },

        /** Wire inbound acks/messages from peer registry bytes path. */
        handleWireFromRemote(remote: string, raw: string) {
            const parsed = parseChatDataWireEnvelope(raw);
            if (!parsed) return;
            if (parsed.t === "messageAck") {
                markDelivered(parsed.clientMsgId, remote);
                return;
            }
            if (parsed.t === "chatHistorySync") {
                void parsed;
                return;
            }
            if (parsed.t === "chatMessage") {
                // Ack is deferred to acknowledgeInbound() once the consumer
                // accepts the message (see bridge onInbound handler).
                bus.emit("inbound", {
                    spaceUuid: parsed.spaceUuid,
                    from: parsed.from,
                    body: parsed.body,
                    sendTimestamp: parsed.sendTimestamp,
                    clientMsgId: parsed.clientMsgId,
                    remote,
                });
            }
        },
    } as MessagingService & {
        handleWireFromRemote(remote: string, raw: string): void;
    };
}

export type { MessagingEvents };
