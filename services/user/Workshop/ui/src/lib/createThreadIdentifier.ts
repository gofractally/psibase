import slugify from "slugify";
import { Account } from "./zodTypes";
import { MessageType } from "@/hooks/useMessages";

export const getThreadIdentifier = (message: MessageType, useSender = true) =>
  slugify(
    `${Account.parse(useSender ? message.sender : message.receiver)} ${
      message.subject
    }`,
    {
      lower: true,
    }
  );
