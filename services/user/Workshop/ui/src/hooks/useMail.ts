import { Account } from "@/lib/zodTypes";
import { queryClient } from "@/queryClient";
import { supervisor } from "@/supervisor";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { Message, MessageType } from "./useMessages";
import dayjs from "dayjs";
import { AwaitTime } from "@/lib/globals";

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
        intf: "mail",
        method: action.method,
        params:
          action.method == "send"
            ? [action.app, action.receiver, action.subject, action.body]
            : [action.app, action.messageId],
      });
    },
    onSuccess: (_, vars) => {
      if (vars.method == "send") {
        const queryKey = ["messages", vars.receiver];
        queryClient.setQueryData(queryKey, (data: unknown) => {
          if (data) {
            const messages = Message.array().parse(data);
            const newMessages: MessageType[] = [
              ...messages,
              {
                body: vars.body,
                datetime: dayjs().toISOString(),
                isSavedMsg: false,
                msgId: BigInt(Math.floor(Math.random() * 10000)),
                receiver: vars.receiver,
                sender: vars.app,
                subject: vars.subject,
              },
            ];
            return Message.array().parse(newMessages);
          }
        });

        setTimeout(() => {
          queryClient.invalidateQueries({ queryKey });
        }, AwaitTime);
      }
    },
  });
