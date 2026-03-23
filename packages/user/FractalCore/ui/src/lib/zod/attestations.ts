import { z } from "zod";

import { zAccount } from "@shared/lib/schemas/account";
import { zDateTime } from "@shared/lib/schemas/date-time";

export const zGuildAttestationListInstance = z.object({
    attester: zAccount,
    comment: z.string(),
    endorses: z.boolean(),
});

export const zGuildApplicationListInstance = z.object({
    applicant: zAccount,
    extraInfo: z.string(),
    createdAt: zDateTime,
    score: z.object({
        current: z.number().int(),
        required: z.number().int()
    }),
    attestations: z.object({
        nodes: zGuildAttestationListInstance.array(),
    }),
});

export type GuildApplicationListInstance = z.infer<
    typeof zGuildApplicationListInstance
>;