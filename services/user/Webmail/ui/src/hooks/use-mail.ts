import { atom, useAtom } from "jotai";

import { useUser } from "./use-user";
import { useQuery } from "@tanstack/react-query";

const composeAtom = atom(false);
export function useCompose() {
    return useAtom(composeAtom);
}

export type Message = {
    id: string;
    from: string;
    to: string;
    datetime: number;
    status: "draft" | "sent";
    read: boolean;
    inReplyTo: string | null;
    subject: string;
    body: string;
};

type RawMessage = {
    sender: string;
    receiver: string;
    subject: string;
    body: string;
};

const transformRawMessagesToMessages = (rawMessages: RawMessage[]) => {
    return rawMessages.reverse().map(
        (msg, i) =>
            ({
                id: `${msg.sender}-${msg.receiver}-${msg.subject}-${msg.body}`,
                from: msg.sender,
                to: msg.receiver,
                datetime: Date.now() - i * 1_000_000,
                status: "sent",
                read: false,
                inReplyTo: null,
                subject: msg.subject,
                body: msg.body,
            }) as Message,
    );
};

const getIncomingMessages = async (account: string) => {
    const res = await fetch(`/messages?receiver=${account}`);
    const rawMessages = (await res.json()) as RawMessage[];
    return transformRawMessagesToMessages(rawMessages);
};

const incomingMsgAtom = atom<Message["id"]>("");
export function useIncomingMessages() {
    const [selectedAccount] = useUser();
    const query = useQuery({
        queryKey: ["incoming", selectedAccount.account],
        queryFn: () => getIncomingMessages(selectedAccount.account),
        enabled: Boolean(selectedAccount.account),
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

const getSentMessages = async (account: string) => {
    const res = await fetch(`/messages?sender=${account}`);
    const rawMessages = (await res.json()) as RawMessage[];
    return transformRawMessagesToMessages(rawMessages);
};

const sentMsgAtom = atom<Message["id"]>("");
export function useSentMessages() {
    const [selectedAccount] = useUser();
    const query = useQuery({
        queryKey: ["sent", selectedAccount.account],
        queryFn: () => getSentMessages(selectedAccount.account),
        enabled: Boolean(selectedAccount.account),
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
