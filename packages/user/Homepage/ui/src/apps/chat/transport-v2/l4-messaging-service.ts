import {
    parseChatDataWireEnvelope,
    serializeChatDataMessage,
    type ChatDataMessageAckEnvelope,
    type ChatDataMessageEnvelope,
} from "../lib/chat-data-envelope";
import {
    loadPendingMessages,
    savePendingMessagesWithQuotaRecovery,
    type PendingChatMessage,
} from "../lib/pending-message-store";
import {
    pslackConversationIdFromSpaceUuid,
    spaceUuidFromPslackConversationId,
} from "../lib/space-bridge";
import type { RealtimeTransport } from "./l1-realtime-transport";
import type { PeerTransportRegistry } from "./l3-peer-registry";
import { EventBus } from "./event-bus";
import {
    IN_FLIGHT_ACK_WAIT_MS,
    MAX_VALID_ATTEMPTS,
    type InboundEnvelope,
    type MessageStatus,
    type PendingCount,
    type SendGroupRequest,
    type SendRequest,
    type Unsubscribe,
} from "./types";

type MessagingEvents = {
    statusChange: (msgId: string, status: MessageStatus) => void;
    inbound: (envelope: InboundEnvelope) => void;
    recipientDelivered: (msgId: string, recipient: string, conversationId: string) => void;
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
        handler: (msgId: string, recipient: string, conversationId: string) => void,
    ): Unsubscribe;
    hydrateFromStorage(): void;
}

type InFlightKey = `${string}\0${string}`;

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
    const inFlight = new Map<InFlightKey, InFlightRow>();
    const validAttempts = new Map<InFlightKey, number>();
    const statusByMsg = new Map<string, MessageStatus>();

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
        if (!pingOk) {
            opts.peerRegistry.dispose(recipient, "ack_timeout");
        }

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

    const trySendToRecipient = (row: PendingChatMessage, recipient: string) => {
        if (row.deliveredTo.includes(recipient)) return;
        const peerUsable = opts.peerRegistry.getState(recipient) === "usable";
        if (!opts.realtime.isRecipientOnline(recipient) && !peerUsable) {
            return;
        }

        const key = inFlightKey(row.clientMsgId, recipient);
        if (inFlight.has(key)) return;

        const spaceUuid = spaceUuidFromPslackConversationId(row.conversationId);
        if (opts.isSpaceMember && !opts.isSpaceMember(spaceUuid, recipient)) {
            markFailed(row.clientMsgId, recipient, "recipient not a space member");
            return;
        }

        const envelope = buildEnvelope(row, recipient);
        const bytes = new TextEncoder().encode(
            serializeChatDataMessage(envelope),
        );
        const result = opts.peerRegistry.send(recipient, bytes);
        if (!result.ok) {
            void opts.peerRegistry.ensure(recipient, "message_enqueued");
            return;
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
    };

    const flushRemote = async (remote: string) => {
        await opts.peerRegistry.ensure(remote, "message_enqueued");
        const pending = outboxByRemote().get(remote) ?? [];
        for (const row of pending) {
            trySendToRecipient(row, remote);
        }
    };

    const flushAll = () => {
        for (const remote of outboxByRemote().keys()) {
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
            void opts.peerRegistry.ensure(recipient, "message_enqueued");
            void flushRemote(recipient);
        }
    };

    opts.peerRegistry.on("usable", (remote) => {
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
            // Keep in sync with hook-level pending writes before enqueue.
            rows = loadPendingMessages(opts.chainId, opts.localAccount);
            const msgId = req.clientMsgId ?? newClientMsgId(now());
            const row: PendingChatMessage = {
                clientMsgId: msgId,
                conversationId: pslackConversationIdFromSpaceUuid(req.spaceUuid),
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
            rows = loadPendingMessages(opts.chainId, opts.localAccount);
            const msgId = req.clientMsgId ?? newClientMsgId(now());
            const row: PendingChatMessage = {
                clientMsgId: msgId,
                conversationId: pslackConversationIdFromSpaceUuid(req.spaceUuid),
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
                rowStatus(findRow(msgId) ?? {
                    clientMsgId: msgId,
                    conversationId: "",
                    from: opts.localAccount,
                    body: "",
                    createdAt: 0,
                    recipients: [],
                    deliveredTo: [],
                    status: "failed",
                })
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
            for (const row of rows) {
                syncRowStatus(row);
            }
            flushAll();
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
                bus.emit("inbound", {
                    spaceUuid: parsed.spaceUuid,
                    from: parsed.from,
                    body: parsed.body,
                    sendTimestamp: parsed.sendTimestamp,
                    clientMsgId: parsed.clientMsgId,
                });
                const ack: ChatDataMessageAckEnvelope = {
                    t: "messageAck",
                    spaceUuid: parsed.spaceUuid,
                    clientMsgId: parsed.clientMsgId,
                    from: opts.localAccount,
                };
                const bytes = new TextEncoder().encode(JSON.stringify(ack));
                opts.peerRegistry.send(remote, bytes);
            }
        },
    } as MessagingService & {
        handleWireFromRemote(remote: string, raw: string): void;
    };
}

export type { MessagingEvents };
