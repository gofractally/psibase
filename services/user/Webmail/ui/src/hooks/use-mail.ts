import { atom, useAtom } from "jotai";

import { useUser } from "./use-user";
import { useQuery } from "@tanstack/react-query";
import { useLocalStorage } from "./use-local-storage";
import { Supervisor } from "@psibase/common-lib/supervisor";

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

const supervisor = new Supervisor();

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
    console.info("getIncomingMessages.top()");
    let resp;
    try {
        await supervisor.onLoaded();
        resp = await supervisor.functionCall({
            service: "webmail",
            intf: "queries",
            method: "getMessages",
            params: ["", account],
        });
    } catch (e) {
        console.info("e:", e);
    }
    console.info("resp:", resp);
    // const res = await fetch(`/messages?receiver=${account}`);
    // const rawMessages = (await res.json()) as RawMessage[];
    return transformRawMessagesToMessages(resp as RawMessage[]);
};

const incomingMsgAtom = atom<Message["id"]>("");
export function useIncomingMessages() {
    const { user } = useUser();
    const query = useQuery({
        queryKey: ["incoming", user],
        queryFn: () => getIncomingMessages(user),
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

const getSentMessages = async (account: string) => {
    console.info("getSentMessages.top()")
    await supervisor.onLoaded();
    const resp = await supervisor.functionCall({
                service: "webmail",
                intf: "queries",
                method: "getMessages",
                params: [account, ""],
            });
    console.info("resp:");
    console.info(resp);

    // const res = await fetch(`/messages?sender=${account}`);
    // const rawMessages = (await res.json()) as RawMessage[];
    return transformRawMessagesToMessages(resp as RawMessage[]);
};

const sentMsgAtom = atom<Message["id"]>("");
export function useSentMessages() {
    const { user } = useUser();
    const query = useQuery({
        queryKey: ["sent", user],
        queryFn: () => getSentMessages(user),
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
    const { user } = useUser();

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
