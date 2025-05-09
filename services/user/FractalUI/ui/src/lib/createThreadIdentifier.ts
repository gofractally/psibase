import slugify from "slugify";
import { Account } from "./zodTypes";
import { MessageType } from "@/hooks/useMessages";
import { z } from "zod";

export const removeReplyPrefix = (subject: string) =>
  z.string().parse(subject).startsWith("RE: ") ? subject.slice(4) : subject;

export const getThreadIdentifier = (message: MessageType, useSender = true) =>
  slugify(
    `${Account.parse(
      useSender ? message.sender : message.receiver
    )} ${removeReplyPrefix(message.subject)}`,
    {
      lower: true,
    }
  );
