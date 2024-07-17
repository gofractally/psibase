import { atom, useAtom } from "jotai";

import { useUser } from "./use-user";
import { useLocalStorage } from "./use-local-storage";
import { Mail, mails } from "../fixtures/data";

type Config = {
    selected: Mail["id"] | null;
};

const configAtom = atom<Config>({
    selected: mails[0].id,
});
export function useMail() {
    return useAtom(configAtom);
}

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

const msgAtom = atom<Message["id"]>("");
export function useLocalMail() {
    const [selectedAccount, setSelectedAccount] = useUser();
    const [messages, setMessages, getMessages] = useLocalStorage<Message[]>(
        "messages",
        [],
    );

    const [selectedMessageId, setSelectedMessageId] = useAtom(msgAtom);

    const selectedMessage = messages?.find(
        (msg) => msg.id === selectedMessageId,
    );

    return [messages, selectedMessage, setSelectedMessageId] as const;
}
