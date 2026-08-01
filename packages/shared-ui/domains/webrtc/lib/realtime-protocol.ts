import { z } from "zod";

import type { ServerRealtimeFrame } from "./realtime-protocol-server";
import { serverRealtimeFrameSchema } from "./realtime-protocol-server";

export {
    REALTIME_AUTH_SUBPROTOCOL_PREFIX,
    REALTIME_SERVICE,
    REALTIME_SUBPROTOCOL_V1,
} from "./realtime-protocol-constants";

export {
    iceServerConfigSchema,
    peerPresenceSchema,
    presenceStatusSchema,
    type IceServerConfig,
    type PeerPresence,
} from "./realtime-schemas";

export {
    clientFrameClientReadySchema,
    clientFrameJoinSessionSchema,
    clientFrameLeaveSessionSchema,
    clientFrameParticipantStateSchema,
    clientFramePingSchema,
    clientFrameSignalSchema,
    clientRealtimeFrameSchema,
    participantStatePayloadSchema,
    signalKindSchema,
    type ClientRealtimeFrame,
} from "./realtime-protocol-client";

export {
    chatAppMetadataSchema,
    dataChannelSpecSchema,
    serverFrameParticipantJoinedSchema,
    serverFrameParticipantStateSchema,
    serverFramePresenceSnapshotSchema,
    serverFrameRealtimeErrorSchema,
    serverFrameRealtimePongSchema,
    serverFrameRealtimePresenceSchema,
    serverFrameRealtimeSignalSchema,
    serverFrameRealtimeWelcomeSchema,
    serverFrameSessionEndedSchema,
    serverFrameSessionInviteSchema,
    serverFrameSessionSnapshotSchema,
    serverFrameTransportLostSchema,
    serverRealtimeFrameSchema,
    welcomeActiveSessionSchema,
    type ServerRealtimeFrame,
} from "./realtime-protocol-server";

export interface ParseOk<T> {
    ok: true;
    value: T;
}

export interface ParseFail {
    ok: false;
    error: z.ZodError | Error;
}

export type ParseResult<T> = ParseOk<T> | ParseFail;

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
        data = JSON.parse(text) as unknown;
    } catch (e) {
        return {
            ok: false,
            error: e instanceof Error ? e : new Error(String(e)),
        };
    }
    return parseServerRealtimeFrame(data);
}
