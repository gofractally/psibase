import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { zAccount } from "@shared/lib/schemas/account";
import { supervisor } from "@shared/lib/supervisor";

export const Message = z.object({
    body: z.string(),
    datetime: z.string(),
    isSavedMsg: z.boolean(),
    msgId: z.bigint(),
    receiver: zAccount,
    sender: zAccount,
    subject: z.string(),
});

export type MessageType = z.infer<typeof Message>;

export const useMessages = (app: string | undefined) =>
    useQuery({
        queryKey: ["messages", app],
        enabled: !!app,
        queryFn: async () => {
            const res = await supervisor.functionCall({
                service: "chainmail",
                intf: "queries",
                method: "getMsgs",
                params: [undefined, app],
            });
            return Message.array().parse(res);
        },
    });
