import type { Message } from "../types";

import { useCallback, useMemo } from "react";
import { useLocalStorage } from "usehooks-ts";

import { useCurrentUser } from "@shared/hooks/use-current-user";

import { useIncomingMessages, useSentMessages } from "./use-mail";

export interface Conversation {
    /** The other account in the conversation (the user themself for notes). */
    peer: string;
    /** Oldest first. */
    messages: Message[];
    last: Message;
    unread: number;
}

type ReadState = Record<string, number>;

/**
 * Chain mail has no read receipts, so "read" is tracked per device: the
 * timestamp of the newest incoming message the user has seen, per peer.
 */
const useReadState = () => {
    const { data: user } = useCurrentUser();
    const [lastRead, setLastRead] = useLocalStorage<ReadState>(
        `chainmail:last-read:${user ?? ""}`,
        {},
    );

    const markRead = useCallback(
        (entries: Record<string, number>) => {
            setLastRead((prev) => {
                let changed = false;
                const next = { ...prev };
                for (const [peer, at] of Object.entries(entries)) {
                    if ((next[peer] ?? 0) < at) {
                        next[peer] = at;
                        changed = true;
                    }
                }
                return changed ? next : prev;
            });
        },
        [setLastRead],
    );

    return { lastRead, markRead };
};

const peerOf = (message: Message) =>
    message.type === "outgoing" ? message.to : message.from;

export const useConversations = () => {
    const { data: user } = useCurrentUser();
    const inbox = useIncomingMessages();
    const sent = useSentMessages();
    const { lastRead, markRead } = useReadState();

    const conversations = useMemo<Conversation[]>(() => {
        if (!user) return [];
        const seen = new Set<string>();
        const byPeer = new Map<string, Message[]>();
        for (const msg of [...(inbox.data ?? []), ...(sent.data ?? [])]) {
            // Notes to self show up in both mailboxes
            const key = msg.msgId.toString();
            if (seen.has(key)) continue;
            seen.add(key);
            const peer = peerOf(msg);
            const list = byPeer.get(peer) ?? [];
            list.push(msg);
            byPeer.set(peer, list);
        }
        return [...byPeer.entries()]
            .map(([peer, messages]) => {
                messages.sort((a, b) => a.datetime - b.datetime);
                const since = lastRead[peer] ?? 0;
                return {
                    peer,
                    messages,
                    last: messages[messages.length - 1],
                    unread: messages.filter(
                        (m) => m.type === "incoming" && m.datetime > since,
                    ).length,
                };
            })
            .sort((a, b) => b.last.datetime - a.last.datetime);
    }, [user, inbox.data, sent.data, lastRead]);

    const unreadTotal = conversations.reduce((n, c) => n + c.unread, 0);

    const markConversationRead = useCallback(
        (conversation: Conversation) => {
            const newest = conversation.messages
                .filter((m) => m.type === "incoming")
                .at(-1)?.datetime;
            if (newest) markRead({ [conversation.peer]: newest });
        },
        [markRead],
    );

    const markAllRead = useCallback(() => {
        const entries: Record<string, number> = {};
        for (const c of conversations) {
            const newest = c.messages
                .filter((m) => m.type === "incoming")
                .at(-1)?.datetime;
            if (newest) entries[c.peer] = newest;
        }
        markRead(entries);
    }, [conversations, markRead]);

    return {
        conversations,
        unreadTotal,
        isLoading: inbox.isLoading || sent.isLoading,
        isError: inbox.isError || sent.isError,
        error: inbox.error ?? sent.error,
        markConversationRead,
        markAllRead,
    };
};

const SUBJECT_MAX = 60;

/** Chat messages have no subject line, so one is derived from the text. */
export const deriveSubject = (body: string) => {
    const line = body.trim().split("\n")[0].trim();
    return line.length > SUBJECT_MAX
        ? `${line.slice(0, SUBJECT_MAX - 1).trimEnd()}…`
        : line;
};

/** Hide subjects that just repeat the start of the message (or "RE: …"). */
export const hasDistinctSubject = (
    message: Pick<Message, "subject" | "body">,
) => {
    const subject = message.subject.trim();
    if (!subject || /^re:/i.test(subject)) return false;
    return !message.body.trim().startsWith(subject.replace(/…$/, ""));
};
