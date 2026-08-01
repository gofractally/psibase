import { zAccount } from "@shared/lib/schemas/account";
import { z } from "zod";

export const presenceStatusSchema = z.enum(["online", "offline"]);

export const peerPresenceSchema = z
    .object({
        account: zAccount,
        presence: presenceStatusSchema,
    })
    .strict();

export type PeerPresence = z.infer<typeof peerPresenceSchema>;

const iceUrlsSchema = z.union([z.string(), z.array(z.string())]);

export const iceServerConfigSchema = z
    .object({
        urls: iceUrlsSchema,
        username: z.string().optional(),
        credential: z.string().optional(),
    })
    .strict();

export type IceServerConfig = z.infer<typeof iceServerConfigSchema>;
