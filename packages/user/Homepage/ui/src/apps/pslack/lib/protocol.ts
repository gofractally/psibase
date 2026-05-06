import { z } from "zod";

/** Psibase account string (syntax validated server-side). */
const zAccountStr = z.string();

const presenceStatusSchema = z.enum(["online", "offline"]);
const conversationKindSchema = z.enum(["dm", "group"]);

/** Contact row inside a server {@link ServerFrameSync} snapshot. */
export const contactPresenceSchema = z
    .object({
        account: zAccountStr,
        presence: presenceStatusSchema,
    })
    .strict();

/** Conversation row inside a server {@link ServerFrameSync} snapshot. */
export const conversationSnapshotSchema = z
    .object({
        conversationId: z.string(),
        kind: conversationKindSchema,
        members: z.array(zAccountStr),
    })
    .strict();

export type ContactPresence = z.infer<typeof contactPresenceSchema>;
export type ConversationSnapshot = z.infer<typeof conversationSnapshotSchema>;

// --- Client → server frames (v1)

export const clientFrameSyncSchema = z
    .object({
        t: z.literal("sync"),
        knownConversationIds: z.array(z.string()).optional(),
    })
    .strict();

export const clientFrameOpenDmSchema = z
    .object({
        t: z.literal("openDm"),
        member: zAccountStr,
    })
    .strict();

export const clientFrameOpenGroupSchema = z
    .object({
        t: z.literal("openGroup"),
        members: z.array(zAccountStr),
    })
    .strict();

export const clientFrameSaySchema = z
    .object({
        t: z.literal("say"),
        conversationId: z.string(),
        body: z.string(),
        clientMsgId: z.string(),
    })
    .strict();

export const clientFrameAckSchema = z
    .object({
        t: z.literal("ack"),
        conversationId: z.string(),
        serverMsgId: z.number(),
    })
    .strict();

export const clientFramePingSchema = z
    .object({
        t: z.literal("ping"),
    })
    .strict();

export const clientFrameSignalSchema = z
    .object({
        t: z.literal("signal"),
        conversationId: z.string(),
        to: zAccountStr,
        payload: z.unknown(),
    })
    .strict();

export const clientFrameSchema = z.discriminatedUnion("t", [
    clientFrameSyncSchema,
    clientFrameOpenDmSchema,
    clientFrameOpenGroupSchema,
    clientFrameSaySchema,
    clientFrameAckSchema,
    clientFramePingSchema,
    clientFrameSignalSchema,
]);

export type ClientFrame = z.infer<typeof clientFrameSchema>;

// --- Server → client frames (v1)

export const serverFrameWelcomeSchema = z
    .object({
        t: z.literal("welcome"),
        user: zAccountStr,
        serverTime: z.number(),
    })
    .strict();

export const serverFrameSyncSchema = z
    .object({
        t: z.literal("sync"),
        contacts: z.array(contactPresenceSchema),
        conversations: z.array(conversationSnapshotSchema),
    })
    .strict();

export const serverFrameConversationSchema = z
    .object({
        t: z.literal("conversation"),
        conversationId: z.string(),
        kind: conversationKindSchema,
        members: z.array(zAccountStr),
    })
    .strict();

export const serverFramePresenceSchema = z
    .object({
        t: z.literal("presence"),
        account: zAccountStr,
        status: presenceStatusSchema,
        socketCount: z.number().int().nonnegative().optional(),
    })
    .strict();

export const serverFrameMessageSchema = z
    .object({
        t: z.literal("message"),
        conversationId: z.string(),
        from: zAccountStr,
        body: z.string(),
        serverMsgId: z.number(),
        serverTime: z.number(),
        clientMsgId: z.string().optional(),
    })
    .strict();

export const serverFrameDeliveredSchema = z
    .object({
        t: z.literal("delivered"),
        conversationId: z.string(),
        serverMsgId: z.number(),
        to: zAccountStr,
    })
    .strict();

export const serverFrameErrorSchema = z
    .object({
        t: z.literal("error"),
        code: z.string(),
        reason: z.string(),
        conversationId: z.string().optional(),
    })
    .strict();

export const serverFramePongSchema = z
    .object({
        t: z.literal("pong"),
    })
    .strict();

export const serverFrameSchema = z.discriminatedUnion("t", [
    serverFrameWelcomeSchema,
    serverFrameSyncSchema,
    serverFrameConversationSchema,
    serverFramePresenceSchema,
    serverFrameMessageSchema,
    serverFrameDeliveredSchema,
    serverFrameErrorSchema,
    serverFramePongSchema,
]);

export type ServerFrame = z.infer<typeof serverFrameSchema>;

export interface ParseOk<T> {
    ok: true;
    value: T;
}

export interface ParseFail {
    ok: false;
    error: z.ZodError | Error;
}

export type ParseResult<T> = ParseOk<T> | ParseFail;

function jsonUnknown(text: string): unknown {
    return JSON.parse(text) as unknown;
}

/** Parse unknown JSON value as a validated client frame. */
export function parseClientFrame(json: unknown): ParseResult<ClientFrame> {
    const r = clientFrameSchema.safeParse(json);
    if (r.success) return { ok: true, value: r.data };
    return { ok: false, error: r.error };
}

/** Parse a websocket text payload as a client frame. */
export function parseClientFrameText(text: string): ParseResult<ClientFrame> {
    let data: unknown;
    try {
        data = jsonUnknown(text);
    } catch (e) {
        return {
            ok: false,
            error: e instanceof Error ? e : new Error(String(e)),
        };
    }
    return parseClientFrame(data);
}

/** Parse unknown JSON value as a validated server frame. */
export function parseServerFrame(json: unknown): ParseResult<ServerFrame> {
    const r = serverFrameSchema.safeParse(json);
    if (r.success) return { ok: true, value: r.data };
    return { ok: false, error: r.error };
}

/** Parse a websocket text payload as a server frame. */
export function parseServerFrameText(text: string): ParseResult<ServerFrame> {
    let data: unknown;
    try {
        data = jsonUnknown(text);
    } catch (e) {
        return {
            ok: false,
            error: e instanceof Error ? e : new Error(String(e)),
        };
    }
    return parseServerFrame(data);
}

/**
 * Parses server JSON and throws on validation failure — use with care;
 * prefer {@link parseServerFrameText}.
 */
export function assertServerFrameText(text: string): ServerFrame {
    const parsed = parseServerFrameText(text);
    if (!parsed.ok) throw parsed.error;
    return parsed.value;
}
