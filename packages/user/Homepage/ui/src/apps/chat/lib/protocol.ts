import { z } from "zod";

/** Legacy interim group-chat websocket subprotocols (pre-realtime.v1). */
export const PSLACK_SUBPROTOCOL_V1 = "psibase.pslack.v1";
export const PSLACK_SUBPROTOCOL_V2 = "psibase.pslack.v2";

/** Psibase account string (syntax validated server-side). */
const zAccountStr = z.string();

export const presenceStatusSchema = z.enum(["online", "offline"]);
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

/** DM call-history row discriminator (architecture §3.4 / §2.3). */
export const callTimelineEventSchema = z.enum([
    "started",
    "ended",
    "missed",
    "declined",
    "cancelled",
    "failed",
]);

export type CallTimelineEventType = z.infer<typeof callTimelineEventSchema>;

const iceUrlsSchema = z.union([z.string(), z.array(z.string())]);

export const iceServerConfigSchema = z
    .object({
        urls: iceUrlsSchema,
        username: z.string().optional(),
        credential: z.string().optional(),
    })
    .strict();

export type IceServerConfig = z.infer<typeof iceServerConfigSchema>;

// --- Client → server frames (chat + v2 call control)

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
        clientTime: z.number().optional(),
        to: zAccountStr.optional(),
    })
    .strict();

export const clientFrameAckSchema = z
    .object({
        t: z.literal("ack"),
        conversationId: z.string(),
        serverMsgId: z.number(),
        clientMsgId: z.string().optional(),
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

export const clientFrameCallInviteSchema = z
    .object({
        t: z.literal("callInvite"),
        conversationId: z.string(),
        wantVideo: z.boolean(),
        wantAudio: z.boolean(),
        clientCallId: z.string(),
    })
    .strict();

export const clientFrameCallAcceptSchema = z
    .object({
        t: z.literal("callAccept"),
        callId: z.string(),
    })
    .strict();

export const clientFrameCallDeclineSchema = z
    .object({
        t: z.literal("callDecline"),
        callId: z.string(),
        reason: z.string().optional(),
    })
    .strict();

export const clientFrameCallOfferSchema = z
    .object({
        t: z.literal("callOffer"),
        callId: z.string(),
        sdp: z.string(),
    })
    .strict();

export const clientFrameCallAnswerSchema = z
    .object({
        t: z.literal("callAnswer"),
        callId: z.string(),
        sdp: z.string(),
    })
    .strict();

export const clientFrameCallCandidateSchema = z
    .object({
        t: z.literal("callCandidate"),
        callId: z.string(),
        candidate: z.string().nullable(),
        sdpMid: z.string().optional(),
        sdpMLineIndex: z.number().optional(),
    })
    .strict();

export const clientFrameCallMediaStateSchema = z
    .object({
        t: z.literal("callMediaState"),
        callId: z.string(),
        audioMuted: z.boolean(),
        videoMuted: z.boolean(),
    })
    .strict();

export const clientFrameCallHangupSchema = z
    .object({
        t: z.literal("callHangup"),
        callId: z.string(),
        reason: z.string().optional(),
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
    clientFrameCallInviteSchema,
    clientFrameCallAcceptSchema,
    clientFrameCallDeclineSchema,
    clientFrameCallOfferSchema,
    clientFrameCallAnswerSchema,
    clientFrameCallCandidateSchema,
    clientFrameCallMediaStateSchema,
    clientFrameCallHangupSchema,
]);

export type ClientFrame = z.infer<typeof clientFrameSchema>;

// --- Server → client frames

export const serverFrameWelcomeSchema = z
    .object({
        t: z.literal("welcome"),
        user: zAccountStr,
        serverTime: z.number(),
    })
    .strict();

export const serverFrameIceServersSchema = z
    .object({
        t: z.literal("iceServers"),
        servers: z.array(iceServerConfigSchema),
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
        clientTime: z.number().optional(),
        to: zAccountStr.optional(),
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
        clientMsgId: z.string().optional(),
        to: zAccountStr.optional(),
    })
    .strict();

/** Routed call framing from service (architecture §3.4). */
export const serverFrameInboundCallInviteSchema = z
    .object({
        t: z.literal("callInvite"),
        callId: z.string(),
        conversationId: z.string(),
        from: zAccountStr,
        to: zAccountStr,
        wantVideo: z.boolean(),
        wantAudio: z.boolean(),
        serverTime: z.number(),
    })
    .strict();

export const serverFrameInboundCallAcceptSchema = z
    .object({
        t: z.literal("callAccept"),
        callId: z.string(),
        by: zAccountStr,
    })
    .strict();

export const serverFrameInboundCallDeclineSchema = z
    .object({
        t: z.literal("callDecline"),
        callId: z.string(),
        by: zAccountStr,
        reason: z.string().optional(),
    })
    .strict();

export const serverFrameInboundCallOfferSchema = z
    .object({
        t: z.literal("callOffer"),
        callId: z.string(),
        from: zAccountStr,
        sdp: z.string(),
    })
    .strict();

export const serverFrameInboundCallAnswerSchema = z
    .object({
        t: z.literal("callAnswer"),
        callId: z.string(),
        from: zAccountStr,
        sdp: z.string(),
    })
    .strict();

export const serverFrameInboundCallCandidateSchema = z
    .object({
        t: z.literal("callCandidate"),
        callId: z.string(),
        from: zAccountStr,
        candidate: z.string().nullable(),
        sdpMid: z.string().optional(),
        sdpMLineIndex: z.number().optional(),
    })
    .strict();

export const serverFrameInboundCallMediaStateSchema = z
    .object({
        t: z.literal("callMediaState"),
        callId: z.string(),
        from: zAccountStr,
        audioMuted: z.boolean(),
        videoMuted: z.boolean(),
    })
    .strict();

export const serverFrameInboundCallHangupSchema = z
    .object({
        t: z.literal("callHangup"),
        callId: z.string(),
        by: zAccountStr,
        reason: z.string().optional(),
    })
    .strict();

export const serverFrameCallTimeoutSchema = z
    .object({
        t: z.literal("callTimeout"),
        callId: z.string(),
        conversationId: z.string(),
        caller: zAccountStr,
        callee: zAccountStr,
    })
    .strict();

export const serverFrameCallEventSchema = z
    .object({
        t: z.literal("callEvent"),
        conversationId: z.string(),
        callId: z.string().optional(),
        event: callTimelineEventSchema,
        actor: zAccountStr.optional(),
        reason: z.string().optional(),
        durationMs: z.number().optional(),
        serverMsgId: z.number(),
        serverTime: z.number(),
    })
    .strict();

export const serverFrameCallErrorSchema = z
    .object({
        t: z.literal("callError"),
        code: z.string(),
        reason: z.string(),
        callId: z.string().optional(),
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
    serverFrameIceServersSchema,
    serverFrameSyncSchema,
    serverFrameConversationSchema,
    serverFramePresenceSchema,
    serverFrameMessageSchema,
    serverFrameDeliveredSchema,
    serverFrameErrorSchema,
    serverFrameCallEventSchema,
    serverFrameCallErrorSchema,
    serverFrameCallTimeoutSchema,
    serverFrameInboundCallInviteSchema,
    serverFrameInboundCallAcceptSchema,
    serverFrameInboundCallDeclineSchema,
    serverFrameInboundCallOfferSchema,
    serverFrameInboundCallAnswerSchema,
    serverFrameInboundCallCandidateSchema,
    serverFrameInboundCallMediaStateSchema,
    serverFrameInboundCallHangupSchema,
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

/** Parse a websocket text payload as a validated server frame. */
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
