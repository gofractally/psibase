import { AlertCircle, Clock3, Phone } from "lucide-react";
import { useEffect, useRef } from "react";

import { Avatar } from "@shared/components/avatar";
import { ScrollArea } from "@shared/shadcn/ui/scroll-area";

import { cn } from "@shared/lib/utils";

import type {
    ChatTimelineCallEventRow,
    ChatTimelineMessageRow,
    ChatTimelineRow,
} from "@/apps/chat/hooks/use-chat-socket";

type Props = {
    timeline: ChatTimelineRow[];
    selfAccount: string | null;
};

function formatCallEventReason(reason: string | undefined): string | undefined {
    if (!reason) return undefined;
    if (reason === "ice-failed") {
        return "media connection failed (try another network or TURN quota may be exhausted)";
    }
    return reason;
}

function callEventLabel(row: ChatTimelineCallEventRow) {
    const verb =
        row.event === "started"
            ? "Call started"
            : row.event === "ended"
              ? "Call ended"
              : row.event === "missed"
                ? "Missed call"
                : row.event === "declined"
                  ? "Call declined"
                  : row.event === "cancelled"
                    ? "Call cancelled"
                    : "Call failed";

    let suffix = "";
    if (row.reason) {
        const r = formatCallEventReason(row.reason) ?? row.reason;
        suffix += ` · ${r}`;
    }
    if (typeof row.durationMs === "number")
        suffix += ` · ${Math.round(row.durationMs / 1000)}s`;

    const actorNote =
        row.actor && row.actor.trim().length > 0 ? ` · ${row.actor}` : "";
    return `${verb}${actorNote}${suffix}`;
}

function CallEventRow({
    row,
}: {
    row: ChatTimelineCallEventRow;
}) {
    const label = callEventLabel(row);
    return (
        <div className="flex w-full justify-center px-2 py-1">
            <div
                className="text-muted-foreground inline-flex max-w-[min(420px,92%)] items-center gap-2 rounded-full border border-border/60 bg-muted/40 px-4 py-1.5 text-xs"
                title={label}
            >
                <Phone className="size-3.5 shrink-0 opacity-70" aria-hidden />
                <span className="text-center font-medium tracking-tight">
                    {label}
                </span>
            </div>
        </div>
    );
}

function MessageBubbleRow({
    m,
    selfAccount,
}: {
    m: ChatTimelineMessageRow;
    selfAccount: string | null;
}) {
    const mine = selfAccount !== null && m.from === selfAccount;
    const pending = m.status === "pending";
    const failed = m.status === "failed";

    return (
        <div
            className={cn(
                "flex gap-2",
                mine ? "justify-end" : "justify-start",
            )}
        >
            {!mine ? (
                <Avatar
                    account={m.from}
                    className="size-8 shrink-0 self-end"
                />
            ) : null}

            <div
                className={cn(
                    "max-w-[85%] rounded-xl border px-3 py-2 shadow-sm",
                    mine
                        ? "bg-primary text-primary-foreground border-transparent"
                        : "bg-card",
                    pending && "opacity-80",
                    failed &&
                        mine &&
                        "border-destructive bg-destructive/15 text-foreground",
                )}
            >
                {!mine ? (
                    <p className="mb-0.5 text-xs font-semibold opacity-80">
                        {m.from}
                    </p>
                ) : null}
                <p className="break-words text-sm whitespace-pre-wrap">
                    {m.body}
                </p>

                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0 text-[11px] opacity-70">
                    {pending ? (
                        <span
                            className="inline-flex items-center gap-1"
                            title="Stored in this browser until every recipient is online and acknowledged."
                        >
                            <Clock3 className="size-3" aria-hidden />
                            Pending
                            {m.pendingRecipientCount
                                ? ` (${m.pendingRecipientCount})`
                                : ""}
                        </span>
                    ) : failed ? (
                        <span className="inline-flex items-center gap-1">
                            <AlertCircle className="size-3" aria-hidden />
                            Failed
                        </span>
                    ) : null}
                    {failed && m.errorReason ? (
                        <span
                            className="text-destructive max-w-[220px] truncate font-medium"
                            title={m.errorReason}
                        >
                            {m.errorReason}
                        </span>
                    ) : null}
                </div>
            </div>

            {mine ? (
                <Avatar
                    account={m.from}
                    className="size-8 shrink-0 self-end opacity-90"
                />
            ) : null}
        </div>
    );
}

export function MessageThread({ timeline, selfAccount }: Props) {
    const bottomRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [timeline]);

    if (timeline.length === 0) {
        return (
            <div className="text-muted-foreground flex flex-1 flex-col items-center justify-center p-8 text-center text-sm">
                No messages in this conversation yet.
            </div>
        );
    }

    return (
        <ScrollArea className="flex min-h-0 flex-1 px-3">
            <div className="flex flex-col gap-3 py-4">
                {timeline.map((row) => {
                    if (row.kind === "callEvent") {
                        return <CallEventRow key={row.key} row={row} />;
                    }
                    return (
                        <MessageBubbleRow
                            key={row.key}
                            m={row}
                            selfAccount={selfAccount}
                        />
                    );
                })}
                <div ref={bottomRef} />
            </div>
        </ScrollArea>
    );
}
