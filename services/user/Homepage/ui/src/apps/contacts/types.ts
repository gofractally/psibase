import { Account } from "@/lib/zod/Account";
import { z } from "zod";

export const LocalContact = z.object({
    account: Account,
    nickname: z.string().optional(),
    email: z.string().optional(),
    phone: z.string().optional(),
});

export const ProcessedContact = LocalContact.extend({
    avatar: z.string(),
});

export type LocalContactType = z.infer<typeof LocalContact>;
export type ProcessedContactType = z.infer<typeof ProcessedContact>;
