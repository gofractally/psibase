import type { DraftMessage, Mailbox, Message } from "@/apps/chainmail/types";

import { Search } from "lucide-react";
import { useMemo, useState } from "react";

import { formatDistanceToNow } from "@/apps/chainmail/utils";

import { Avatar } from "@shared/components/avatar";
import { cn } from "@shared/lib/utils";
import {
    Empty,
    EmptyDescription,
    EmptyHeader,
    EmptyTitle,
} from "@shared/shadcn/ui/empty";
import { Input } from "@shared/shadcn/ui/input";
import { ScrollArea } from "@shared/shadcn/ui/scroll-area";
import { Skeleton } from "@shared/shadcn/ui/skeleton";

import { EmptyBox } from "./empty-states";

interface SharedProps {
    mailbox: Mailbox;
    selectedMessage?: Message | DraftMessage;
    onSelectMessage: (id: string) => void;
    isLoading?: boolean;
}

export interface MailListProps extends SharedProps {
    messages: Message[] | DraftMessage[];
}

function MailListSkeleton() {
    return (
        <div className="divide-border divide-y" aria-hidden>
            {Array.from({ length: 6 }).map((_, index) => (
                <div key={index} className="flex gap-3 px-4 py-3">
                    <Skeleton className="size-10 shrink-0 rounded-full" />
                    <div className="min-w-0 flex-1 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                            <Skeleton className="h-4 w-28" />
                            <Skeleton className="h-3 w-12" />
                        </div>
                        <Skeleton className="h-4 w-2/3" />
                        <Skeleton className="h-3 w-full" />
                    </div>
                </div>
            ))}
        </div>
    );
}

export function MailList({
    mailbox,
    messages,
    selectedMessage,
    onSelectMessage,
    isLoading,
}: MailListProps) {
    const [search, setSearch] = useState("");

    const sortedMessages = useMemo(
        () => [...messages].sort((a, b) => b.datetime - a.datetime),
        [messages],
    );

    const filteredMessages = useMemo(() => {
        const query = search.trim().toLowerCase();
        if (!query) return sortedMessages;

        return sortedMessages.filter((message) => {
            const account = mailbox === "inbox" ? message.from : message.to;
            return (
                account.toLowerCase().includes(query) ||
                message.subject.toLowerCase().includes(query) ||
                message.body.toLowerCase().includes(query)
            );
        });
    }, [sortedMessages, search, mailbox]);

    if (isLoading) {
        return (
            <div className="bg-sidebar/40 flex h-full flex-col">
                <div className="border-border shrink-0 border-b px-4 py-2">
                    <Skeleton className="h-9 w-full" />
                </div>
                <MailListSkeleton />
            </div>
        );
    }

    const showMailboxEmpty = messages.length === 0;
    const showSearchEmpty = !showMailboxEmpty && filteredMessages.length === 0;

    return (
        <div className="bg-sidebar/40 relative flex h-full min-h-0 flex-col overflow-hidden">
            <div className="border-border relative z-10 shrink-0 border-b px-4 py-2">
                <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-7 size-4 -translate-y-1/2" />
                <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search mail..."
                    className="bg-background pl-9"
                    aria-label="Search mail"
                />
            </div>

            {showMailboxEmpty || showSearchEmpty ? (
                <div className="absolute inset-0">
                    {showMailboxEmpty ? (
                        <EmptyBox mailbox={mailbox} />
                    ) : (
                        <Empty className="h-full border-none">
                            <EmptyHeader>
                                <EmptyTitle>No matches</EmptyTitle>
                                <EmptyDescription>
                                    Try a different search term.
                                </EmptyDescription>
                            </EmptyHeader>
                        </Empty>
                    )}
                </div>
            ) : (
                <ScrollArea className="min-h-0 flex-1 overflow-hidden">
                    <div
                        role="listbox"
                        aria-label={`${mailbox} messages`}
                        className="divide-border divide-y pb-4"
                    >
                        {filteredMessages.map((message) => {
                            const account =
                                mailbox === "inbox"
                                    ? message.from
                                    : message.to;
                            const isSelected =
                                selectedMessage?.id === message.id;
                            const preview = message.body
                                .replace(/\s+/g, " ")
                                .trim();
                            const isUnread =
                                mailbox === "inbox" && !message.read;

                            return (
                                <button
                                    key={message.id}
                                    type="button"
                                    role="option"
                                    aria-selected={isSelected}
                                    onClick={() => onSelectMessage(message.id)}
                                    className={cn(
                                        "hover:bg-accent/50 focus-visible:ring-ring relative flex w-full gap-3 px-4 py-3 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-inset",
                                        isSelected && "bg-muted",
                                    )}
                                >
                                    {isSelected ? (
                                        <span
                                            aria-hidden
                                            className="bg-primary absolute inset-y-0 left-0 w-0.5"
                                        />
                                    ) : null}
                                    {account ? (
                                        <Avatar
                                            account={account}
                                            className="size-10 shrink-0"
                                            alt={`${account} avatar`}
                                        />
                                    ) : null}
                                    <div className="min-w-0 flex-1 space-y-0.5">
                                        <div className="flex items-center justify-between gap-2">
                                            <p
                                                className={cn(
                                                    "truncate text-sm",
                                                    isUnread
                                                        ? "font-semibold"
                                                        : "font-medium",
                                                )}
                                            >
                                                {mailbox === "inbox"
                                                    ? message.from
                                                    : `To: ${message.to}`}
                                            </p>
                                            <time
                                                className="text-muted-foreground shrink-0 text-xs tabular-nums"
                                                dateTime={new Date(
                                                    message.datetime,
                                                ).toISOString()}
                                                title={new Date(
                                                    message.datetime,
                                                ).toLocaleString()}
                                            >
                                                {formatDistanceToNow(
                                                    message.datetime,
                                                )}
                                            </time>
                                        </div>
                                        <p
                                            className={cn(
                                                "truncate text-sm",
                                                isUnread
                                                    ? "font-semibold"
                                                    : "text-foreground/90 font-normal",
                                            )}
                                        >
                                            {message.subject || "(No subject)"}
                                        </p>
                                        {preview ? (
                                            <p className="text-muted-foreground line-clamp-2 text-sm font-normal">
                                                {preview.slice(0, 300)}
                                            </p>
                                        ) : null}
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </ScrollArea>
            )}
        </div>
    );
}
