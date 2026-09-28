import type { Conversation } from "../hooks/use-conversations";

import { ArrowLeft, Coins, Lock } from "lucide-react";
import { Fragment, useLayoutEffect, useMemo, useRef } from "react";
import { Link } from "react-router-dom";

import { CopyIcon, useDisplayName } from "@/components/account-cell";

import { colorFor } from "@/lib/colors";

import { Avatar } from "@shared/components/avatar";
import { useCurrentUser } from "@shared/hooks/use-current-user";
import { cn } from "@shared/lib/utils";
import { Button } from "@shared/shadcn/ui/button";

import { hasDistinctSubject } from "../hooks/use-conversations";
import { formatClock, formatDayLabel, isSameDay } from "../utils";
import { Composer, type OutgoingMessage } from "./composer";

export interface PendingMessage extends OutgoingMessage {
    key: string;
    peer: string;
    at: number;
}

interface Bubble {
    key: string;
    outgoing: boolean;
    subject: string;
    body: string;
    datetime: number;
    pending?: boolean;
}

/** Consecutive messages from the same side within this window are grouped. */
const GROUP_MS = 5 * 60 * 1000;

interface Props {
    peer: string;
    conversation?: Conversation;
    pending: PendingMessage[];
    onSend: (message: OutgoingMessage) => Promise<boolean>;
    onBack?: () => void;
}

export const Thread = ({
    peer,
    conversation,
    pending,
    onSend,
    onBack,
}: Props) => {
    const { data: user } = useCurrentUser();
    const name = useDisplayName(peer);
    const isSelf = peer === user;
    const title = isSelf ? "Notes to self" : (name ?? peer);

    const bubbles = useMemo<Bubble[]>(
        () => [
            ...(conversation?.messages ?? []).map((m) => ({
                key: m.msgId.toString(),
                outgoing: m.type === "outgoing",
                subject: m.subject,
                body: m.body,
                datetime: m.datetime,
            })),
            ...pending.map((p) => ({
                key: p.key,
                outgoing: true,
                subject: p.subject,
                body: p.body,
                datetime: p.at,
                pending: true,
            })),
        ],
        [conversation?.messages, pending],
    );

    const scrollRef = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
        const el = scrollRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [peer, bubbles.length]);

    return (
        <div className="flex h-full min-h-0 flex-col">
            <header className="flex h-12 shrink-0 items-center gap-3 border-b px-3 sm:px-4">
                {onBack && (
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={onBack}
                        aria-label="Back to chats"
                        className="-ml-1"
                    >
                        <ArrowLeft className="size-4" />
                    </Button>
                )}
                <Avatar
                    account={peer}
                    className="size-8 border-0 shadow-none"
                    alt=""
                />
                <div className="min-w-0 flex-1 leading-tight">
                    <div className="truncate text-sm font-semibold">
                        {title}
                    </div>
                    <div className="text-muted-foreground flex items-center gap-1 font-mono text-[11px]">
                        <span className="truncate">@{peer}</span>
                        <CopyIcon value={peer} className="[&_svg]:size-3" />
                    </div>
                </div>
                {!isSelf && (
                    <Button
                        asChild
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                    >
                        <Link to={`/tokens?to=${encodeURIComponent(peer)}`}>
                            <Coins className="size-3.5" />
                            <span className="hidden sm:inline">
                                Send tokens
                            </span>
                        </Link>
                    </Button>
                )}
            </header>

            <div
                ref={scrollRef}
                className="scrollbar-thin min-h-0 flex-1 overflow-y-auto"
            >
                <div className="mx-auto flex min-h-full max-w-3xl flex-col justify-end px-3 py-4 sm:px-6">
                    <ThreadIntro
                        peer={peer}
                        title={title}
                        isSelf={isSelf}
                        empty={bubbles.length === 0}
                    />
                    {bubbles.map((b, i) => {
                        const prev = bubbles[i - 1];
                        const next = bubbles[i + 1];
                        const newDay =
                            !prev || !isSameDay(prev.datetime, b.datetime);
                        const first =
                            newDay ||
                            prev.outgoing !== b.outgoing ||
                            b.datetime - prev.datetime > GROUP_MS;
                        const last =
                            !next ||
                            next.outgoing !== b.outgoing ||
                            next.datetime - b.datetime > GROUP_MS ||
                            !isSameDay(next.datetime, b.datetime);
                        return (
                            <Fragment key={b.key}>
                                {newDay && (
                                    <div className="text-muted-foreground my-4 flex items-center gap-3 text-[11px] font-medium">
                                        <span className="bg-border h-px flex-1" />
                                        {formatDayLabel(b.datetime)}
                                        <span className="bg-border h-px flex-1" />
                                    </div>
                                )}
                                <BubbleRow
                                    bubble={b}
                                    peer={peer}
                                    first={first}
                                    last={last}
                                    showAvatar={!isSelf}
                                />
                            </Fragment>
                        );
                    })}
                </div>
            </div>

            <Composer
                key={peer}
                peer={peer}
                placeholder={
                    isSelf ? "Write a note to yourself" : `Message ${title}`
                }
                onSend={onSend}
            />
        </div>
    );
};

const ThreadIntro = ({
    peer,
    title,
    isSelf,
    empty,
}: {
    peer: string;
    title: string;
    isSelf: boolean;
    empty: boolean;
}) => (
    <div
        className={cn(
            "flex flex-col items-center gap-2 text-center",
            empty ? "my-auto py-10" : "pb-2 pt-6",
        )}
    >
        <Avatar
            account={peer}
            className="size-16 rounded-2xl border-2 shadow-none"
            style={{ borderColor: colorFor(peer) }}
            alt=""
        />
        <div>
            <div className="text-base font-semibold tracking-tight">
                {title}
            </div>
            <div className="text-muted-foreground font-mono text-xs">
                @{peer}
            </div>
        </div>
        <p className="text-muted-foreground max-w-sm text-xs leading-relaxed">
            {isSelf
                ? "Jot down notes, links and reminders. They'll be here in any app that uses Chain mail."
                : `This is the start of your conversation with ${title}. It follows you into any app that uses Chain mail.`}
        </p>
        <p className="text-muted-foreground/80 inline-flex items-center gap-1 text-[11px]">
            <Lock className="size-3" />
            Messages are not encrypted.
        </p>
    </div>
);

const BubbleRow = ({
    bubble,
    peer,
    first,
    last,
    showAvatar,
}: {
    bubble: Bubble;
    peer: string;
    first: boolean;
    last: boolean;
    showAvatar: boolean;
}) => {
    const { outgoing, pending } = bubble;
    const subject = hasDistinctSubject(bubble) ? bubble.subject : null;

    return (
        <div
            className={cn(
                "flex items-end gap-2",
                outgoing ? "justify-end" : "justify-start",
                first ? "mt-3" : "mt-0.5",
            )}
        >
            {!outgoing &&
                showAvatar &&
                (last ? (
                    <Avatar
                        account={peer}
                        className="size-6 shrink-0 border-0 shadow-none"
                        alt=""
                    />
                ) : (
                    <span className="w-6 shrink-0" />
                ))}
            <div
                className={cn(
                    "flex min-w-0 max-w-[78%] flex-col",
                    outgoing ? "items-end" : "items-start",
                )}
            >
                <div
                    className={cn(
                        "whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm leading-relaxed transition-opacity",
                        outgoing
                            ? "bg-[var(--brand)] text-[var(--brand-foreground)]"
                            : "bg-muted text-foreground",
                        last && (outgoing ? "rounded-br-md" : "rounded-bl-md"),
                        pending && "opacity-60",
                    )}
                    title={formatClock(bubble.datetime)}
                >
                    {subject && (
                        <div className="mb-0.5 text-xs font-semibold opacity-80">
                            {subject}
                        </div>
                    )}
                    {bubble.body}
                </div>
                {last && (
                    <span className="text-muted-foreground mt-1 px-1 text-[10px] tabular-nums">
                        {pending ? "Sending…" : formatClock(bubble.datetime)}
                    </span>
                )}
            </div>
        </div>
    );
};
