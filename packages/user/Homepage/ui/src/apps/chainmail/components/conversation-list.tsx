import type { Conversation } from "../hooks/use-conversations";

import { MessagesSquare, Search, SquarePen } from "lucide-react";
import { useState } from "react";

import { useDisplayName } from "@/components/account-cell";
import { EmptyState } from "@/components/empty-state";

import { Avatar } from "@shared/components/avatar";
import { useCurrentUser } from "@shared/hooks/use-current-user";
import { cn } from "@shared/lib/utils";
import { Button } from "@shared/shadcn/ui/button";
import { Input } from "@shared/shadcn/ui/input";
import { Skeleton } from "@shared/shadcn/ui/skeleton";

import { firstLine, formatChatTime } from "../utils";

interface Props {
    conversations: Conversation[];
    selected: string | null;
    isLoading: boolean;
    onSelect: (peer: string) => void;
    onNewChat: () => void;
}

export const ConversationList = ({
    conversations,
    selected,
    isLoading,
    onSelect,
    onNewChat,
}: Props) => {
    const [search, setSearch] = useState("");
    const q = search.trim().toLowerCase();
    const filtered = q
        ? conversations.filter(
              (c) =>
                  c.peer.includes(q) ||
                  c.messages.some((m) => m.body.toLowerCase().includes(q)),
          )
        : conversations;

    return (
        <div className="flex h-full min-h-0 flex-col">
            <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b px-4">
                <div className="flex items-baseline gap-2">
                    <h1 className="text-sm font-semibold">Chats</h1>
                    {conversations.length > 0 && (
                        <span className="text-muted-foreground font-mono text-[11px] tabular-nums">
                            {conversations.length}
                        </span>
                    )}
                </div>
                <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={onNewChat}
                >
                    <SquarePen className="size-3.5" />
                    New chat
                </Button>
            </header>
            {conversations.length > 0 && (
                <div className="shrink-0 border-b p-2">
                    <div className="relative">
                        <Search className="text-muted-foreground pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2" />
                        <Input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search chats…"
                            aria-label="Search chats"
                            className="h-8 pl-8 text-sm"
                        />
                    </div>
                </div>
            )}
            <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-1.5">
                {isLoading ? (
                    <div className="flex flex-col gap-1">
                        {Array.from({ length: 5 }).map((_, i) => (
                            <div
                                key={i}
                                className="flex items-center gap-3 px-2.5 py-2"
                            >
                                <Skeleton className="size-10 rounded-full" />
                                <div className="flex flex-1 flex-col gap-1.5">
                                    <Skeleton className="h-3.5 w-1/2" />
                                    <Skeleton className="h-3 w-3/4" />
                                </div>
                            </div>
                        ))}
                    </div>
                ) : filtered.length === 0 ? (
                    <EmptyState
                        icon={MessagesSquare}
                        detail={
                            q
                                ? "Try a different name or phrase."
                                : "Start one with anyone on the network."
                        }
                    >
                        {q ? "No matching chats" : "No chats yet"}
                    </EmptyState>
                ) : (
                    <ul className="flex flex-col gap-0.5">
                        {filtered.map((c) => (
                            <ConversationRow
                                key={c.peer}
                                conversation={c}
                                active={c.peer === selected}
                                onSelect={onSelect}
                            />
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
};

const ConversationRow = ({
    conversation: { peer, last, unread },
    active,
    onSelect,
}: {
    conversation: Conversation;
    active: boolean;
    onSelect: (peer: string) => void;
}) => {
    const { data: user } = useCurrentUser();
    const name = useDisplayName(peer);
    const isSelf = peer === user;
    const title = isSelf ? "Notes to self" : (name ?? peer);
    const preview =
        (last.type === "outgoing" && !isSelf ? "You: " : "") +
        firstLine(last.body);

    return (
        <li>
            <button
                type="button"
                onClick={() => onSelect(peer)}
                aria-current={active || undefined}
                className={cn(
                    "flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors",
                    active ? "bg-accent" : "hover:bg-accent/50",
                )}
            >
                <span className="relative shrink-0">
                    <Avatar
                        account={peer}
                        className="size-10 border-0 shadow-none"
                        alt=""
                    />
                    {unread > 0 && (
                        <span className="ring-background absolute -right-0.5 -top-0.5 size-3 rounded-full bg-[var(--brand)] ring-2" />
                    )}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex items-baseline justify-between gap-2">
                        <span
                            className={cn(
                                "truncate text-sm",
                                unread ? "font-semibold" : "font-medium",
                            )}
                        >
                            {title}
                        </span>
                        <span
                            className={cn(
                                "shrink-0 text-[11px] tabular-nums",
                                unread
                                    ? "font-medium text-[var(--brand)]"
                                    : "text-muted-foreground",
                            )}
                        >
                            {formatChatTime(last.datetime)}
                        </span>
                    </span>
                    <span className="flex items-center justify-between gap-2">
                        <span
                            className={cn(
                                "truncate text-xs",
                                unread
                                    ? "text-foreground"
                                    : "text-muted-foreground",
                            )}
                        >
                            {preview}
                        </span>
                        {unread > 0 && (
                            <span className="min-w-4 shrink-0 rounded-full bg-[var(--brand)] px-1.5 text-center text-[10px] font-semibold tabular-nums leading-4 text-[var(--brand-foreground)]">
                                {unread}
                            </span>
                        )}
                    </span>
                </span>
            </button>
        </li>
    );
};
