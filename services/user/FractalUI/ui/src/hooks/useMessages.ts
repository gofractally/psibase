import { Account } from "@/lib/zodTypes";
import { supervisor } from "@/supervisor";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

export const Message = z.object({
  body: z.string(),
  datetime: z.string(),
  isSavedMsg: z.boolean(),
  msgId: z.bigint(),
  receiver: Account,
  sender: Account,
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
