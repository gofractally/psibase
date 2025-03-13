import { useQuery, useQueryClient } from "@tanstack/react-query";
import { atom, useAtom } from "jotai";
import { useCallback } from "react";

import { supervisor } from "@/supervisor";

import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useLocalStorage } from "@/hooks/useLocalStorage";

import { Mailbox } from "../types";

const composeAtom = atom(false);
export function useCompose() {
    return useAtom(composeAtom);
}

export type Message = {
    id: string;
    msgId: string;
    from: string;
    to: string;
    datetime: number;
    isDraft: boolean;
    type: "incoming" | "outgoing";
    read: boolean;
    saved: boolean;
    inReplyTo: string | null;
    subject: string;
    body: string;
};

type RawMessage = {
    body: string;
    datetime: string;
    isSavedMsg: boolean;
    msgId: string;
    receiver: string;
    sender: string;
    subject: string;
};

const transformRawMessagesToMessages = (
    rawMessages: RawMessage[],
    currentUser: string,
) => {
    console.log(rawMessages);
    return rawMessages.reverse().map(
        (msg, i) =>
            ({
                id: `${msg.sender}-${msg.receiver}-${msg.subject}-${msg.body}`,
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
        queryKey: ["inbox", user],
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
        queryKey: ["archived", user],
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
        queryKey: ["saved", user],
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
        queryKey: ["sent", user],
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

    const [allDrafts, setDrafts, getDrafts] = useLocalStorage<Message[]>(
        "drafts",
        [],
    );

    const deleteDraftById = (id: string) => {
        // using getDrafts() here instead of messages prevents stale closure
        const data = getDrafts() ?? [];
        const remainingDrafts = data.filter((d) => d.id !== id);
        setDrafts(remainingDrafts);
    };

    const drafts = allDrafts?.filter((d) => d.from === user);

    const [selectedMessageId, setSelectedMessageId] = useAtom(draftMsgAtom);
    const selectedMessage = drafts?.find((msg) => msg.id === selectedMessageId);

    return {
        drafts,
        setDrafts,
        getDrafts,
        deleteDraftById,
        selectedMessage,
        setSelectedMessageId,
    };
}

export const useInvalidateMailboxQueries = () => {
    const queryClient = useQueryClient();
    const { data: user } = useCurrentUser();

    const invalidate = useCallback(
        (
            mailboxes: Omit<Mailbox, "drafts">[] = [
                "inbox",
                "archived",
                "sent",
                "saved",
            ],
        ) => {
            mailboxes.forEach((mailbox) => {
                queryClient.invalidateQueries({
                    queryKey: [mailbox, user],
                });
            });
        },
        [queryClient, user],
    );

    return invalidate;
};
