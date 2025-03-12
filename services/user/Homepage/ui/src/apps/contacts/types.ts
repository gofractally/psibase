import { Account } from "@/lib/zod/Account";
import { z } from "zod";

export const ContactSchema = z.object({
    account: Account,
    displayName: z.string().optional(),
    email: z.string().email().optional(),
    phone: z.string().optional(),
});

export type Contact = z.infer<typeof ContactSchema>;
