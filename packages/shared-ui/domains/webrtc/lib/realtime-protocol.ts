import { z } from "zod";

import {
    contactPresenceSchema,
    iceServerConfigSchema,
    presenceStatusSchema,
} from "./realtime-schemas";

export {
    contactPresenceSchema,
    iceServerConfigSchema,
    presenceStatusSchema,
    type ContactPresence,
    type IceServerConfig,
} from "./realtime-schemas";

export const REALTIME_SUBPROTOCOL_V1 = "psibase.realtime.v1";
export const REALTIME_AUTH_SUBPROTOCOL_PREFIX = "psibase.bearer.";

/**
 * Local signaling service account (`#[psibase::service(name = "x-wrtcsig")]`).
 * Domain-oriented protocol name above; account string only for URL routing.
 */
export const REALTIME_SERVICE = "x-wrtcsig";

const zAccountStr = z.string();

export const clientFrameClientReadySchema = z
    .object({
        t: z.literal("clientReady"),
        clientInstanceId: z.string(),
        active: z.boolean(),
        visible: z.boolean(),
        supports: z
            .object({
                audio: z.boolean(),
                video: z.boolean(),
                data: z.boolean(),
            })
            .strict(),
    })
    .strict();

export const clientFramePingSchema = z
    .object({
        t: z.literal("ping"),
    })
    .strict();

export const clientFrameJoinSessionSchema = z
    .object({
        t: z.literal("joinSession"),
        sessionId: z.string(),
        clientInstanceId: z.string(),
    })
    .strict();

export const signalKindSchema = z.enum([
    "offer",
    "answer",
    "candidate",
    "end-of-candidates",
]);

export const clientFrameSignalSchema = z
    .object({
        t: z.literal("signal"),
        sessionId: z.string(),
        to: zAccountStr,
        kind: signalKindSchema,
        sdp: z.string().optional(),
        candidate: z.string().optional(),
        sdpMid: z.string().optional(),
        sdpMLineIndex: z.number().int().optional(),
    })
    .strict();

export const clientFrameLeaveSessionSchema = z
    .object({
        t: z.literal("leaveSession"),
        sessionId: z.string(),
        reason: z.string().optional(),
    })
    .strict();

export const participantStatePayloadSchema = z
    .object({
        audioMuted: z.boolean().optional(),
        videoMuted: z.boolean().optional(),
        dataReady: z.boolean().optional(),
    })
    .strict();

export const clientFrameParticipantStateSchema = z
    .object({
        t: z.literal("participantState"),
        sessionId: z.string(),
        state: participantStatePayloadSchema,
    })
    .strict();

export const clientRealtimeFrameSchema = z.discriminatedUnion("t", [
    clientFrameClientReadySchema,
    clientFramePingSchema,
    clientFrameJoinSessionSchema,
    clientFrameSignalSchema,
    clientFrameLeaveSessionSchema,
    clientFrameParticipantStateSchema,
]);

export type ClientRealtimeFrame = z.infer<typeof clientRealtimeFrameSchema>;

/**
 * Active-session hint returned in `welcome` after a reconnect. Lets the client
 * skip the per-space GraphQL `activeSession` poll. Plan B #6 / B5.
 */
export const welcomeActiveSessionSchema = z
    .object({
        sessionId: z.string(),
        purpose: z.string(),
        spaceUuid: z.string(),
        participants: z.array(zAccountStr),
        epoch: z.number().int().nonnegative().optional(),
    })
    .strict();

export const serverFrameRealtimeWelcomeSchema = z
    .object({
        t: z.literal("welcome"),
        user: zAccountStr,
        serverTime: z.number(),
        iceServers: z.array(iceServerConfigSchema),
        activeSessions: z.array(welcomeActiveSessionSchema).optional(),
    })
    .strict();

export const serverFramePresenceSnapshotSchema = z
    .object({
        t: z.literal("presenceSnapshot"),
        contacts: z.array(contactPresenceSchema),
    })
    .strict();

export const serverFrameRealtimePresenceSchema = z
    .object({
        t: z.literal("presence"),
        account: zAccountStr,
        status: presenceStatusSchema,
        socketCount: z.number().int().nonnegative().optional(),
    })
    .strict();

export const serverFrameRealtimeErrorSchema = z
    .object({
        t: z.literal("error"),
        code: z.string(),
        reason: z.string(),
        sessionId: z.string().optional(),
    })
    .strict();

export const serverFrameRealtimePongSchema = z
    .object({
        t: z.literal("pong"),
    })
    .strict();

export const dataChannelSpecSchema = z
    .object({
        label: z.string(),
        ordered: z.boolean(),
    })
    .strict();

export const chatAppMetadataSchema = z
    .object({
        spaceUuid: z.string(),
    })
    .strict();

export const serverFrameSessionInviteSchema = z
    .object({
        t: z.literal("sessionInvite"),
        sessionId: z.string(),
        appService: z.string(),
        appSessionId: z.string(),
        purpose: z.string(),
        from: zAccountStr,
        participants: z.array(zAccountStr),
        transports: z.array(z.string()),
        dataChannels: z.array(dataChannelSpecSchema),
        expiresAt: z.number(),
        appMetadata: chatAppMetadataSchema,
    })
    .strict();

export const serverFrameParticipantJoinedSchema = z
    .object({
        t: z.literal("participantJoined"),
        sessionId: z.string(),
        participant: zAccountStr,
    })
    .strict();

export const serverFrameParticipantStateSchema = z
    .object({
        t: z.literal("participantState"),
        sessionId: z.string(),
        participant: zAccountStr,
        state: participantStatePayloadSchema,
    })
    .strict();

export const serverFrameRealtimeSignalSchema = z
    .object({
        t: z.literal("signal"),
        sessionId: z.string(),
        from: zAccountStr,
        to: zAccountStr,
        kind: signalKindSchema,
        sdp: z.string().optional(),
        candidate: z.string().optional(),
        sdpMid: z.string().optional(),
        sdpMLineIndex: z.number().int().optional(),
    })
    .strict();

export const serverFrameSessionEndedSchema = z
    .object({
        t: z.literal("sessionEnded"),
        sessionId: z.string(),
        by: zAccountStr,
        reason: z.string(),
    })
    .strict();

export const serverFrameSessionSnapshotSchema = z
    .object({
        t: z.literal("sessionSnapshot"),
        sessionId: z.string(),
        epoch: z.number().int().nonnegative(),
        joinedParticipants: z.array(zAccountStr),
        pendingParticipants: z.array(zAccountStr),
    })
    .strict();

export const serverFrameTransportLostSchema = z
    .object({
        t: z.literal("transportLost"),
        sessionId: z.string(),
        participant: zAccountStr,
    })
    .strict();

export const serverRealtimeFrameSchema = z.discriminatedUnion("t", [
    serverFrameRealtimeWelcomeSchema,
    serverFramePresenceSnapshotSchema,
    serverFrameRealtimePresenceSchema,
    serverFrameRealtimeErrorSchema,
    serverFrameRealtimePongSchema,
    serverFrameSessionInviteSchema,
    serverFrameParticipantJoinedSchema,
    serverFrameParticipantStateSchema,
    serverFrameRealtimeSignalSchema,
    serverFrameSessionEndedSchema,
    serverFrameSessionSnapshotSchema,
    serverFrameTransportLostSchema,
]);

export type ServerRealtimeFrame = z.infer<typeof serverRealtimeFrameSchema>;

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

export function parseServerRealtimeFrame(
    json: unknown,
): ParseResult<ServerRealtimeFrame> {
    const r = serverRealtimeFrameSchema.safeParse(json);
    if (r.success) return { ok: true, value: r.data };
    return { ok: false, error: r.error };
}

export function parseServerRealtimeFrameText(
    text: string,
): ParseResult<ServerRealtimeFrame> {
    let data: unknown;
    try {
        data = jsonUnknown(text);
    } catch (e) {
        return {
            ok: false,
            error: e instanceof Error ? e : new Error(String(e)),
        };
    }
    return parseServerRealtimeFrame(data);
}
