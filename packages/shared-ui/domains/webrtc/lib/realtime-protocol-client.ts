import { zAccount } from "@shared/lib/schemas/account";
import { z } from "zod";

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
        to: zAccount,
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
