import type { Message, RawMessage } from "../types";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { z } from "zod";

import QueryKey from "@/lib/query-keys";

import { useCurrentUser } from "@shared/hooks/use-current-user";
import { supervisor } from "@shared/lib/supervisor";

import { zMailbox, zRawMessage, zSendMessageSchema } from "../types";

/** How often mailboxes are re-read so new messages surface in the top bar. */
const MAILBOX_REFETCH_MS = 15_000;

const transformRawMessagesToMessages = (
    rawMessages: RawMessage[],
    currentUser: string,
) => {
    return rawMessages.reverse().map(
        (msg) =>
            ({
                id: `${msg.sender}-${msg.receiver}-${msg.subject}-${msg.datetime}`,
                msgId: msg.msgId,
                from: msg.sender,
                to: msg.receiver,
                datetime: new Date(msg.datetime).getTime(),
                type: msg.sender === currentUser ? "outgoing" : "incoming",
                subject: msg.subject,
                body: msg.body,
            }) as Message,
    );
};

const getIncomingMessages = async (account: string) => {
    const rawMessages = zRawMessage.array().parse(
        await supervisor.functionCall({
            service: "chainmail",
            intf: "queries",
            method: "getMsgs",
            params: [undefined, account],
        }),
    );
    return transformRawMessagesToMessages(rawMessages, account);
};

const getSentMessages = async (account: string) => {
    const rawMessages = zRawMessage.array().parse(
        await supervisor.functionCall({
            service: "chainmail",
            intf: "queries",
            method: "getMsgs",
            params: [account],
        }),
    );
    return transformRawMessagesToMessages(rawMessages, account);
};

export function useIncomingMessages() {
    const { data: user } = useCurrentUser();
    return useQuery({
        queryKey: QueryKey.mailbox("inbox", user!),
        queryFn: () => getIncomingMessages(user!),
        enabled: Boolean(user),
        refetchInterval: MAILBOX_REFETCH_MS,
    });
}

export function useSentMessages() {
    const { data: user } = useCurrentUser();
    return useQuery({
        queryKey: QueryKey.mailbox("sent", user!),
        queryFn: () => getSentMessages(user!),
        enabled: Boolean(user),
        refetchInterval: MAILBOX_REFETCH_MS,
    });
}

export const useInvalidateMailboxQueries = () => {
    const queryClient = useQueryClient();
    const { data: user } = useCurrentUser();

    return useCallback(() => {
        if (!user) return;
        zMailbox.options.forEach((mailbox) => {
            queryClient.invalidateQueries({
                queryKey: QueryKey.mailbox(mailbox, user),
            });
        });
    }, [queryClient, user]);
};

export const useSendMessage = () => {
    return useMutation<void, Error, z.infer<typeof zSendMessageSchema>>({
        mutationFn: async (vars) => {
            const { to, subject, message } = zSendMessageSchema.parse(vars);
            await supervisor.functionCall({
                service: "chainmail",
                intf: "api",
                method: "send",
                params: [to, subject, message],
            });
        },
    });
};
