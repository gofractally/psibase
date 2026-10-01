import type { Conversation } from "@/apps/chainmail/hooks/use-conversations";

import { ArrowRight, MessagesSquare, SquarePen } from "lucide-react";
import { Link } from "react-router-dom";

import { useConversations } from "@/apps/chainmail/hooks/use-conversations";
import { firstLine, formatChatTime } from "@/apps/chainmail/utils";

import { useDisplayName } from "@/components/account-cell";
import { EmptyState } from "@/components/empty-state";
import { Panel } from "@/components/page-header";

import { Avatar } from "@shared/components/avatar";
import { useCurrentUser } from "@shared/hooks/use-current-user";
import { cn } from "@shared/lib/utils";
import { Button } from "@shared/shadcn/ui/button";
import { Skeleton } from "@shared/shadcn/ui/skeleton";

const LIMIT = 5;

export const LatestChats = ({ className }: { className?: string }) => {
    const { conversations, unreadTotal, isLoading } = useConversations();
    const shown = conversations.slice(0, LIMIT);

    return (
        <Panel
            title="Latest chats"
            description={
                unreadTotal
                    ? `${unreadTotal} unread ${unreadTotal === 1 ? "message" : "messages"}`
                    : "Pick up where you left off"
            }
            className={className}
            headerClassName="px-5 py-4"
            actions={
                <>
                    <Button
                        asChild
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                    >
                        <Link to="/chainmail?new=1">
                            <SquarePen className="size-3.5" />
                            New chat
                        </Link>
                    </Button>
                    {conversations.length > 0 && (
                        <Button
                            asChild
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                        >
                            <Link to="/chainmail">
                                All chats
                                <ArrowRight className="size-3.5" />
                            </Link>
                        </Button>
                    )}
                </>
            }
        >
            {isLoading ? (
                <div className="flex flex-col">
                    {Array.from({ length: 3 }).map((_, i) => (
                        <div
                            key={i}
                            className="flex items-center gap-3.5 border-b px-5 py-3.5 last:border-b-0"
                        >
                            <Skeleton className="size-10 rounded-full" />
                            <div className="flex flex-1 flex-col gap-1.5">
                                <Skeleton className="h-3.5 w-1/3" />
                                <Skeleton className="h-3 w-2/3" />
                            </div>
                        </div>
                    ))}
                </div>
            ) : shown.length === 0 ? (
                <EmptyState
                    icon={MessagesSquare}
                    className="min-h-56"
                    detail="Chats you start here show up in every app that uses Chain mail."
                >
                    No chats yet
                </EmptyState>
            ) : (
                <ul className="divide-y">
                    {shown.map((c) => (
                        <ChatRow key={c.peer} conversation={c} />
                    ))}
                </ul>
            )}
        </Panel>
    );
};

const ChatRow = ({
    conversation: { peer, last, unread },
}: {
    conversation: Conversation;
}) => {
    const { data: user } = useCurrentUser();
    const name = useDisplayName(peer);
    const isSelf = peer === user;

    return (
        <li>
            <Link
                to={`/chainmail?with=${encodeURIComponent(peer)}`}
                className="hover:bg-accent/40 group flex items-center gap-3.5 px-5 py-3.5 transition-colors"
            >
                <span className="relative shrink-0">
                    <Avatar
                        account={peer}
                        className="size-10 border-0 shadow-none"
                        alt=""
                    />
                    {unread > 0 && (
                        <span className="ring-card absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-[var(--brand)] ring-2" />
                    )}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex items-baseline gap-2">
                        <span
                            className={cn(
                                "truncate text-sm",
                                unread ? "font-semibold" : "font-medium",
                            )}
                        >
                            {isSelf ? "Notes to self" : (name ?? peer)}
                        </span>
                        {name && !isSelf && (
                            <span className="text-muted-foreground hidden truncate font-mono text-[11px] sm:inline">
                                @{peer}
                            </span>
                        )}
                    </span>
                    <span
                        className={cn(
                            "truncate text-xs",
                            unread
                                ? "text-foreground"
                                : "text-muted-foreground",
                        )}
                    >
                        {last.type === "outgoing" && !isSelf && "You: "}
                        {firstLine(last.body)}
                    </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                    <span className="text-muted-foreground text-[11px] tabular-nums">
                        {formatChatTime(last.datetime)}
                    </span>
                    {unread > 0 && (
                        <span className="min-w-4 rounded-full bg-[var(--brand)] px-1.5 text-center text-[10px] font-semibold tabular-nums leading-4 text-[var(--brand-foreground)]">
                            {unread}
                        </span>
                    )}
                </span>
            </Link>
        </li>
    );
};
