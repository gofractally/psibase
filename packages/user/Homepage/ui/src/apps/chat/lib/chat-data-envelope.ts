import { zAccount } from "@shared/lib/schemas/account";
import { z } from "zod";

/** Wire envelope for DM chat payloads on the ordered `chat` data channel. */
export const chatDataMessageEnvelopeSchema = z.object({
    t: z.literal("chatMessage"),
    spaceUuid: z.string().min(1),
    from: zAccount,
    body: z.string(),
    sendTimestamp: z.number().finite(),
    clientMsgId: z.string().min(1),
});

export type ChatDataMessageEnvelope = z.infer<
    typeof chatDataMessageEnvelopeSchema
>;

const chatHistorySyncMessageSchema = z.object({
    from: zAccount,
    body: z.string(),
    sendTimestamp: z.number().finite(),
    clientMsgId: z.string().min(1),
});

/** Batch DM history pushed by the existing peer on data channel connect. */
export const chatHistorySyncEnvelopeSchema = z.object({
    t: z.literal("chatHistorySync"),
    spaceUuid: z.string().min(1),
    messages: z.array(chatHistorySyncMessageSchema),
});

export type ChatHistorySyncEnvelope = z.infer<
    typeof chatHistorySyncEnvelopeSchema
>;

/**
 * Application-level delivery acknowledgement.
 *
 * Without this, a `chatMessage` is marked "delivered" the moment the local
 * data channel write succeeds — but the underlying SCTP send is fire-and-
 * forget and the receiving peer may close the channel a few ms later (tab
 * navigation, ICE rebinding, NAT timeout, browser SCTP bug). The message
 * is then lost forever and the UI shows "sent" while the recipient never
 * saw it.
 *
 * The ack envelope is sent by the receiver *after* the chat message has
 * been persisted locally (via `onChatMessage`). The sender treats a
 * received ack as the only signal that a recipient has actually received
 * the message; until then the message stays in the pending store and
 * gets re-flushed every time a new data channel opens for that recipient.
 */
export const chatDataMessageAckEnvelopeSchema = z.object({
    t: z.literal("messageAck"),
    spaceUuid: z.string().min(1),
    clientMsgId: z.string().min(1),
    /** Account confirming receipt (i.e. the original recipient). */
    from: zAccount,
});

export type ChatDataMessageAckEnvelope = z.infer<
    typeof chatDataMessageAckEnvelopeSchema
>;

/** Hint peers to reload `mySpaces` after group membership changes on chain. */
export const spaceMembershipHintEnvelopeSchema = z.object({
    t: z.literal("spaceMembershipHint"),
});

export type SpaceMembershipHintEnvelope = z.infer<
    typeof spaceMembershipHintEnvelopeSchema
>;

export type ChatDataWireEnvelope =
    | ChatDataMessageEnvelope
    | ChatHistorySyncEnvelope
    | ChatDataMessageAckEnvelope
    | SpaceMembershipHintEnvelope;

export function serializeChatDataWireEnvelope(
    envelope: ChatDataWireEnvelope,
): string {
    return JSON.stringify(envelope);
}

export function serializeChatDataMessage(
    envelope: ChatDataMessageEnvelope,
): string {
    return serializeChatDataWireEnvelope(envelope);
}

export function parseChatDataWireEnvelope(
    raw: string,
): ChatDataWireEnvelope | null {
    try {
        const data = JSON.parse(raw) as unknown;
        const asMessage = chatDataMessageEnvelopeSchema.safeParse(data);
        if (asMessage.success) return asMessage.data;
        const asSync = chatHistorySyncEnvelopeSchema.safeParse(data);
        if (asSync.success) return asSync.data;
        const asAck = chatDataMessageAckEnvelopeSchema.safeParse(data);
        if (asAck.success) return asAck.data;
        const asHint = spaceMembershipHintEnvelopeSchema.safeParse(data);
        return asHint.success ? asHint.data : null;
    } catch {
        return null;
    }
}

export function parseChatDataMessage(
    raw: string,
): ChatDataMessageEnvelope | null {
    const parsed = parseChatDataWireEnvelope(raw);
    return parsed?.t === "chatMessage" ? parsed : null;
}
