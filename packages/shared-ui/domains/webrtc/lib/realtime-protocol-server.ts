import { zAccount } from "@shared/lib/schemas/account";
import { z } from "zod";

import {
    participantStatePayloadSchema,
    signalKindSchema,
} from "./realtime-protocol-client";
import {
    contactPresenceSchema,
    iceServerConfigSchema,
    presenceStatusSchema,
} from "./realtime-schemas";

/**
 * Active-session hint returned in `welcome` after a reconnect. Lets the client
 * skip the per-space GraphQL `activeSession` poll.
 */
export const welcomeActiveSessionSchema = z
    .object({
        sessionId: z.string(),
        purpose: z.string(),
        spaceUuid: z.string(),
        participants: z.array(zAccount),
        epoch: z.number().int().nonnegative().optional(),
    })
    .strict();

export const serverFrameRealtimeWelcomeSchema = z
    .object({
        t: z.literal("welcome"),
        user: zAccount,
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
        account: zAccount,
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
        from: zAccount,
        participants: z.array(zAccount),
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
        participant: zAccount,
    })
    .strict();

export const serverFrameParticipantStateSchema = z
    .object({
        t: z.literal("participantState"),
        sessionId: z.string(),
        participant: zAccount,
        state: participantStatePayloadSchema,
    })
    .strict();

export const serverFrameRealtimeSignalSchema = z
    .object({
        t: z.literal("signal"),
        sessionId: z.string(),
        from: zAccount,
        to: zAccount,
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
        by: zAccount,
        reason: z.string(),
    })
    .strict();

export const serverFrameSessionSnapshotSchema = z
    .object({
        t: z.literal("sessionSnapshot"),
        sessionId: z.string(),
        epoch: z.number().int().nonnegative(),
        joinedParticipants: z.array(zAccount),
        pendingParticipants: z.array(zAccount),
    })
    .strict();

export const serverFrameTransportLostSchema = z
    .object({
        t: z.literal("transportLost"),
        sessionId: z.string(),
        participant: zAccount,
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
