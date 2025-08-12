import { z } from "zod";

import { Account } from "@/lib/zod/Account";

export const zLocalContact = z.object({
    account: Account,
    nickname: z.string().optional(),
    email: z.string().optional(),
    phone: z.string().optional(),
});

export const zProcessedContact = zLocalContact.extend({
    avatar: z.string(),
});

export type LocalContact = z.infer<typeof zLocalContact>;
export type ProcessedContact = z.infer<typeof zProcessedContact>;
