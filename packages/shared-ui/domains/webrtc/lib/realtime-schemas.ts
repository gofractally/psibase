import { z } from "zod";

/** Psibase account string (syntax validated server-side). */
const zAccountStr = z.string();

export const presenceStatusSchema = z.enum(["online", "offline"]);

export const contactPresenceSchema = z
    .object({
        account: zAccountStr,
        presence: presenceStatusSchema,
    })
    .strict();

export type ContactPresence = z.infer<typeof contactPresenceSchema>;

const iceUrlsSchema = z.union([z.string(), z.array(z.string())]);

export const iceServerConfigSchema = z
    .object({
        urls: iceUrlsSchema,
        username: z.string().optional(),
        credential: z.string().optional(),
    })
    .strict();

export type IceServerConfig = z.infer<typeof iceServerConfigSchema>;
