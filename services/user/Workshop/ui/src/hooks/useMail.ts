import { Account } from "@/lib/zodTypes";
import { supervisor } from "@/supervisor";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

const BaseAction = z.object({
  app: Account,
});

const U64 = z.string();

const Send = BaseAction.extend({
  method: z.literal("send"),
  receiver: Account,
  subject: z.string(),
  body: z.string(),
});

const Archive = BaseAction.extend({
  method: z.literal("archive"),
  messageId: U64,
});

const Save = BaseAction.extend({
  method: z.literal("save"),
  messageId: U64,
});

const Action = z.discriminatedUnion("method", [Archive, Save, Send]);

export const useMail = () =>
  useMutation<void, Error, z.infer<typeof Action>>({
    mutationKey: ["mailFunction"],
    mutationFn: async (data) => {
      const action = Action.parse(data);

      await supervisor.functionCall({
        service: "workshop",
        method: action.method,
        params:
          action.method == "send"
            ? [action.app, action.receiver, action.subject, action.body]
            : [action.app, action.messageId],
      });
    },
  });
