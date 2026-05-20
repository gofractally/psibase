import { z } from "zod";

import {
    contactPresenceSchema,
    iceServerConfigSchema,
    presenceStatusSchema,
} from "./protocol";

export const REALTIME_SUBPROTOCOL_V1 = "psibase.realtime.v1";
export const REALTIME_AUTH_SUBPROTOCOL_PREFIX = "psibase.bearer.";

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

export const clientRealtimeFrameSchema = z.discriminatedUnion("t", [
    clientFrameClientReadySchema,
    clientFramePingSchema,
]);

export type ClientRealtimeFrame = z.infer<typeof clientRealtimeFrameSchema>;

export const serverFrameRealtimeWelcomeSchema = z
    .object({
        t: z.literal("welcome"),
        user: zAccountStr,
        serverTime: z.number(),
        iceServers: z.array(iceServerConfigSchema),
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
    })
    .strict();

export const serverFrameRealtimePongSchema = z
    .object({
        t: z.literal("pong"),
    })
    .strict();

export const serverRealtimeFrameSchema = z.discriminatedUnion("t", [
    serverFrameRealtimeWelcomeSchema,
    serverFramePresenceSnapshotSchema,
    serverFrameRealtimePresenceSchema,
    serverFrameRealtimeErrorSchema,
    serverFrameRealtimePongSchema,
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
