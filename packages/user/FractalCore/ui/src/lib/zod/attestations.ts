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
    attestations: z.object({
        nodes: zGuildAttestationListInstance.array(),
    }),
});

export type GuildApplicationListInstance = z.infer<
    typeof zGuildApplicationListInstance
>;