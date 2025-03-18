import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { atom, useAtom } from "jotai";
import { useCallback } from "react";
import { useLocalStorage } from "usehooks-ts";
import { z } from "zod";

import { supervisor } from "@/supervisor";

import { useCurrentUser } from "@/hooks/useCurrentUser";
import QueryKey from "@/lib/queryKeys";

import { zSendMessageSchema } from "../components/compose-dialog";
import { Message, QueryableMailbox, RawMessage } from "../types";

const composeAtom = atom(false);
export function useCompose() {
    return useAtom(composeAtom);
}

const transformRawMessagesToMessages = (
    rawMessages: RawMessage[],
    currentUser: string,
) => {
    return rawMessages.reverse().map(
        (msg, i) =>
            ({
                id: `${msg.sender}-${msg.receiver}-${msg.subject}-${msg.datetime}`,
                msgId: msg.msgId,
                from: msg.sender,
                to: msg.receiver,
                datetime: new Date(msg.datetime).getTime(),
                isDraft: false,
                type: msg.sender === currentUser ? "outgoing" : "incoming",
                read: false,
                saved: msg.isSavedMsg,
                inReplyTo: null,
                subject: msg.subject,
                body: msg.body,
            }) as Message,
    );
};

const getIncomingMessages = async (account: string) => {
    let rawMessages = (await supervisor.functionCall({
        service: "chainmail",
        intf: "queries",
        method: "getMsgs",
        params: [, account],
    })) as RawMessage[];
    return transformRawMessagesToMessages(rawMessages, account);
};

const incomingMsgAtom = atom<Message["id"]>("");
export function useIncomingMessages() {
    const { data: user } = useCurrentUser();
    const query = useQuery({
        queryKey: QueryKey.mailbox("inbox", user!),
        queryFn: () => getIncomingMessages(user!),
        enabled: Boolean(user),
    });

    const [selectedMessageId, setSelectedMessageId] = useAtom(incomingMsgAtom);
    const selectedMessage = query.data?.find(
        (msg) => msg.id === selectedMessageId,
    );

    return {
        query,
        selectedMessage,
        setSelectedMessageId,
    };
}

const getArchivedMessages = async (account: string) => {
    let rawMessages = (await supervisor.functionCall({
        service: "chainmail",
        intf: "queries",
        method: "getArchivedMsgs",
        params: [, account],
    })) as RawMessage[];
    return transformRawMessagesToMessages(rawMessages, account);
};

const archivedMsgAtom = atom<Message["id"]>("");
export function useArchivedMessages() {
    const { data: user } = useCurrentUser();
    const query = useQuery({
        queryKey: QueryKey.mailbox("archived", user!),
        queryFn: () => getArchivedMessages(user!),
        enabled: Boolean(user),
    });

    const [selectedMessageId, setSelectedMessageId] = useAtom(archivedMsgAtom);
    const selectedMessage = query.data?.find(
        (msg) => msg.id === selectedMessageId,
    );

    return {
        query,
        selectedMessage,
        setSelectedMessageId,
    };
}

const getSavedMessages = async (account: string) => {
    let rawMessages = (await supervisor.functionCall({
        service: "chainmail",
        intf: "queries",
        method: "getSavedMsgs",
        params: [account],
    })) as RawMessage[];

    return transformRawMessagesToMessages(rawMessages, account);
};

const savedMsgAtom = atom<Message["id"]>("");
export function useSavedMessages() {
    const { data: user } = useCurrentUser();
    const query = useQuery({
        queryKey: QueryKey.mailbox("saved", user!),
        queryFn: () => getSavedMessages(user!),
        enabled: Boolean(user),
    });

    const [selectedMessageId, setSelectedMessageId] = useAtom(savedMsgAtom);
    const selectedMessage = query.data?.find(
        (msg) => msg.id === selectedMessageId,
    );

    return {
        query,
        selectedMessage,
        setSelectedMessageId,
    };
}

const getSentMessages = async (account: string) => {
    let rawMessages = (await supervisor.functionCall({
        service: "chainmail",
        intf: "queries",
        method: "getMsgs",
        params: [account],
    })) as RawMessage[];

    return transformRawMessagesToMessages(rawMessages, account);
};

const sentMsgAtom = atom<Message["id"]>("");
export function useSentMessages() {
    const { data: user } = useCurrentUser();
    const query = useQuery({
        queryKey: QueryKey.mailbox("sent", user!),
        queryFn: () => getSentMessages(user!),
        enabled: Boolean(user),
    });

    const [selectedMessageId, setSelectedMessageId] = useAtom(sentMsgAtom);
    const selectedMessage = query.data?.find(
        (msg) => msg.id === selectedMessageId,
    );

    return {
        query,
        selectedMessage,
        setSelectedMessageId,
    };
}

const draftMsgAtom = atom<Message["id"]>("");
export function useDraftMessages() {
    const { data: user } = useCurrentUser();

    const [allDrafts, setDrafts] = useLocalStorage<Message[]>("drafts", []);

    const deleteDraftById = (id: string) => {
        const remainingDrafts = allDrafts.filter((d) => d.id !== id);
        setDrafts(remainingDrafts);
    };

    const userDrafts = allDrafts?.filter((d) => d.from === user);

    const [selectedMessageId, setSelectedMessageId] = useAtom(draftMsgAtom);
    const selectedMessage = userDrafts?.find(
        (msg) => msg.id === selectedMessageId,
    );

    return {
        allDrafts,
        userDrafts,
        setDrafts,
        deleteDraftById,
        selectedMessage,
        setSelectedMessageId,
    };
}

export const useInvalidateMailboxQueries = () => {
    const queryClient = useQueryClient();
    const { data: user } = useCurrentUser();

    const all = ["inbox", "archived", "sent", "saved"] as QueryableMailbox[];
    const invalidate = useCallback(
        (mailboxes = all) => {
            if (!user) return;
            mailboxes.forEach((mailbox) => {
                queryClient.invalidateQueries({
                    queryKey: QueryKey.mailbox(mailbox, user),
                });
            });
        },
        [queryClient, user],
    );

    return invalidate;
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

export const useArchiveMessage = () => {
    return useMutation<void, Error, string | number>({
        mutationFn: async (id) => {
            const messageId = z.coerce.number().parse(id);
            await supervisor.functionCall({
                service: "chainmail",
                intf: "api",
                method: "archive",
                params: [messageId],
            });
        },
    });
};

export const useSaveMessage = () => {
    return useMutation<void, Error, string | number>({
        mutationFn: async (id) => {
            const messageId = z.coerce.number().parse(id);
            await supervisor.functionCall({
                service: "chainmail",
                intf: "api",
                method: "save",
                params: [messageId],
            });
        },
    });
};
