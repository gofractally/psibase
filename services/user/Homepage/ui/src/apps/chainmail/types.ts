import { z } from "zod";

import { Account } from "@/lib/zod/Account";

export const zMailbox = z.enum([
    "inbox",
    "sent",
    "drafts",
    "archived",
    "saved",
]);

export const zMessage = z.object({
    id: z.string(),
    msgId: z.string(),
    from: Account,
    to: Account,
    datetime: z.number(),
    isDraft: z.boolean(),
    type: z.enum(["incoming", "outgoing"]),
    read: z.boolean(),
    saved: z.boolean(),
    inReplyTo: z.string().nullable(),
    subject: z.string(),
    body: z.string(),
});

export const zRawMessage = z.object({
    body: z.string(),
    datetime: z.string(),
    isSavedMsg: z.boolean(),
    msgId: z.string(),
    receiver: Account,
    sender: Account,
    subject: z.string(),
});

export type Mailbox = z.infer<typeof zMailbox>;
export type QueryableMailbox = Exclude<Mailbox, "drafts">;
export type Message = z.infer<typeof zMessage>;
export type RawMessage = z.infer<typeof zRawMessage>;
