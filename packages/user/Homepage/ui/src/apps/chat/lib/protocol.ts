/**
 * Chat UI types that are not part of x-wrtcsig realtime framing.
 * Live websocket/signaling schemas live in `@shared/domains/webrtc`.
 */
import { zAccount } from "@shared/lib/schemas/account";
import { z } from "zod";

export type { IceServerConfig } from "@shared/domains/webrtc";

const conversationKindSchema = z.enum(["dm", "group"]);

/** Conversation row for Chat Space UI (objective Spaces mapped client-side). */
export const conversationSnapshotSchema = z
    .object({
        conversationId: z.string(),
        kind: conversationKindSchema,
        members: z.array(zAccount),
    })
    .strict();

export type ConversationSnapshot = z.infer<typeof conversationSnapshotSchema>;

/** Objective Chat call-timeline event discriminator. */
export const callTimelineEventSchema = z.enum([
    "started",
    "ended",
    "missed",
    "declined",
    "cancelled",
    "failed",
]);

export type CallTimelineEventType = z.infer<typeof callTimelineEventSchema>;
