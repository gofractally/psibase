import { z } from "zod";

import { zAccount } from "@shared/lib/schemas/account";

export const zMailbox = z.enum(["inbox", "sent", "drafts"]);

export const zMessage = z.object({
    id: z.string(),
    msgId: z.bigint(),
    from: zAccount,
    to: zAccount,
    datetime: z.number(),
    isDraft: z.boolean(),
    type: z.enum(["incoming", "outgoing"]),
    read: z.boolean(),
    saved: z.boolean(),
    inReplyTo: z.string().nullable(),
    subject: z.string(),
    body: z.string(),
});

// Drafts are saved as the user types, so the recipient may be empty or an
// incomplete/invalid account name. It is only validated against `zAccount`
// when the message is actually sent (see `zSendMessageSchema`).
export const zDraftMessage = zMessage
    .omit({ msgId: true })
    .extend({ to: z.string() });

export const zRawMessage = z.object({
    body: z.string(),
    datetime: z.string(),
    isSavedMsg: z.boolean(),
    msgId: z.bigint(),
    receiver: zAccount,
    sender: zAccount,
    subject: z.string(),
});

export type Mailbox = z.infer<typeof zMailbox>;
export type QueryableMailbox = Exclude<Mailbox, "drafts">;
export type Message = z.infer<typeof zMessage>;
export type RawMessage = z.infer<typeof zRawMessage>;
export type DraftMessage = z.infer<typeof zDraftMessage>;
