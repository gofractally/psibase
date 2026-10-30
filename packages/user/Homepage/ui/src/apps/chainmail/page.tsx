import type { OutgoingMessage } from "./components/composer";
import type { PendingMessage } from "./components/thread";

import { Lock, MessagesSquare, SquarePen } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMediaQuery } from "usehooks-ts";

import { EmptyState } from "@/components/empty-state";

import { useBranding } from "@shared/hooks/use-branding";
import { zAccount } from "@shared/lib/schemas/account";
import { Button } from "@shared/shadcn/ui/button";
import { toast } from "@shared/shadcn/ui/sonner";

import { ConversationList } from "./components/conversation-list";
import { NewChatDialog } from "./components/new-chat-dialog";
import { Thread } from "./components/thread";
import { useConversations } from "./hooks/use-conversations";
import { useInvalidateMailboxQueries, useSendMessage } from "./hooks/use-mail";

/** Sends are acknowledged before they land, so mailboxes are re-read a few times. */
const REFRESH_AFTER_SEND_MS = [800, 2500, 6000];
const PENDING_TIMEOUT_MS = 30_000;

export default function ChatPage() {
    const [params, setParams] = useSearchParams();
    const peer = params.get("with");
    const isNewChatOpen = params.get("new") === "1";
    const isDesktop = useMediaQuery("(min-width: 1024px)");

    const { conversations, isLoading, markConversationRead } =
        useConversations();
    const conversation = conversations.find((c) => c.peer === peer);

    const { mutateAsync: sendMessage } = useSendMessage();
    const invalidate = useInvalidateMailboxQueries();
    const [pending, setPending] = useState<PendingMessage[]>([]);

    const updateParams = useCallback(
        (changes: Record<string, string | null>) =>
            setParams((prev) => {
                const next = new URLSearchParams(prev);
                for (const [k, v] of Object.entries(changes)) {
                    if (v === null) next.delete(k);
                    else next.set(k, v);
                }
                return next;
            }),
        [setParams],
    );

    const select = (account: string | null) =>
        updateParams({ with: account, new: null });

    useEffect(() => {
        if (conversation && conversation.unread > 0) {
            markConversationRead(conversation);
        }
    }, [conversation, markConversationRead]);

    // Drop optimistic bubbles once the real message shows up
    useEffect(() => {
        setPending((prev) => {
            const next = prev.filter(
                (p) =>
                    !conversations.some(
                        (c) =>
                            c.peer === p.peer &&
                            c.messages.some(
                                (m) =>
                                    m.type === "outgoing" &&
                                    m.body === p.body &&
                                    m.datetime >= p.at - 60_000,
                            ),
                    ),
            );
            return next.length === prev.length ? prev : next;
        });
    }, [conversations]);

    const send = async (to: string, message: OutgoingMessage) => {
        const item: PendingMessage = {
            ...message,
            key: window.crypto.randomUUID?.() ?? String(Math.random()),
            peer: to,
            at: Date.now(),
        };
        setPending((prev) => [...prev, item]);
        try {
            await sendMessage({
                to,
                subject: message.subject,
                message: message.body,
            });
            REFRESH_AFTER_SEND_MS.forEach((ms) =>
                setTimeout(() => invalidate(), ms),
            );
            setTimeout(
                () =>
                    setPending((prev) =>
                        prev.filter((p) => p.key !== item.key),
                    ),
                PENDING_TIMEOUT_MS,
            );
            return true;
        } catch (e) {
            setPending((prev) => prev.filter((p) => p.key !== item.key));
            toast.error("Message not sent", {
                description: e instanceof Error ? e.message : String(e),
            });
            return false;
        }
    };

    const validPeer = peer && zAccount.safeParse(peer).success ? peer : null;
    const showList = isDesktop || !peer;
    const showThread = isDesktop || !!peer;

    return (
        <div className="flex min-h-0 flex-1">
            {showList && (
                <aside
                    className={
                        isDesktop
                            ? "flex min-h-0 w-80 shrink-0 flex-col border-r"
                            : "flex min-h-0 min-w-0 flex-1 flex-col"
                    }
                >
                    <ConversationList
                        conversations={conversations}
                        selected={peer}
                        isLoading={isLoading}
                        onSelect={select}
                        onNewChat={() => updateParams({ new: "1" })}
                    />
                </aside>
            )}
            {showThread && (
                <section className="flex min-h-0 min-w-0 flex-1 flex-col">
                    {validPeer ? (
                        <Thread
                            key={validPeer}
                            peer={validPeer}
                            conversation={conversation}
                            pending={pending.filter(
                                (p) => p.peer === validPeer,
                            )}
                            onSend={(m) => send(validPeer, m)}
                            onBack={isDesktop ? undefined : () => select(null)}
                        />
                    ) : peer ? (
                        <EmptyState
                            detail={`"${peer}" isn't a valid account name.`}
                        >
                            Can&apos;t open this chat
                        </EmptyState>
                    ) : (
                        <NoChatSelected
                            onNewChat={() => updateParams({ new: "1" })}
                        />
                    )}
                </section>
            )}
            <NewChatDialog
                open={isNewChatOpen}
                onOpenChange={(open) =>
                    updateParams({ new: open ? "1" : null })
                }
                onStart={select}
            />
        </div>
    );
}

const NoChatSelected = ({ onNewChat }: { onNewChat: () => void }) => {
    const { data: networkName } = useBranding();
    return (
        <div className="grid-bg flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
            <span className="flex size-12 items-center justify-center rounded-2xl border border-[color-mix(in_oklch,var(--brand)_35%,transparent)] bg-[color-mix(in_oklch,var(--brand)_12%,transparent)] text-[var(--brand)]">
                <MessagesSquare className="size-5" />
            </span>
            <div>
                <h2 className="text-base font-semibold tracking-tight">
                    Your conversations
                </h2>
                <p className="text-muted-foreground mt-1 max-w-sm text-sm">
                    Chat with anyone on {networkName || "the network"}. Apps
                    built on Chain mail share the same conversations, so they
                    follow you wherever you go.
                </p>
            </div>
            <Button size="sm" className="h-8" onClick={onNewChat}>
                <SquarePen className="size-3.5" />
                Start a chat
            </Button>
            <p className="text-muted-foreground/80 inline-flex items-center gap-1 text-[11px]">
                <Lock className="size-3" />
                Messages are not encrypted.
            </p>
        </div>
    );
};
