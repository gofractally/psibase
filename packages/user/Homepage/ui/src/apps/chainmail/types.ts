import { z } from "zod";

import { zAccount } from "@shared/lib/schemas/account";

export const zMailbox = z.enum(["inbox", "sent"]);

export const zMessage = z.object({
    id: z.string(),
    msgId: z.bigint(),
    from: zAccount,
    to: zAccount,
    datetime: z.number(),
    type: z.enum(["incoming", "outgoing"]),
    subject: z.string(),
    body: z.string(),
});

export const zRawMessage = z.object({
    body: z.string(),
    datetime: z.string(),
    isSavedMsg: z.boolean(),
    msgId: z.bigint(),
    receiver: zAccount,
    sender: zAccount,
    subject: z.string(),
});

export const zSendMessageSchema = z.object({
    to: zAccount,
    subject: z.string().min(1),
    message: z.string().min(1),
});

export type Mailbox = z.infer<typeof zMailbox>;
export type Message = z.infer<typeof zMessage>;
export type RawMessage = z.infer<typeof zRawMessage>;
