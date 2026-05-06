import { useEffect, useRef } from "react";

import { Avatar } from "@shared/components/avatar";
import { ScrollArea } from "@shared/shadcn/ui/scroll-area";

import { cn } from "@shared/lib/utils";

import type { PslackUiMessage } from "../hooks/use-pslack-socket";

type Props = {
    messages: PslackUiMessage[];
    selfAccount: string | null;
};

export function MessageThread({ messages, selfAccount }: Props) {
    const bottomRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    if (messages.length === 0) {
        return (
            <div className="text-muted-foreground flex flex-1 flex-col items-center justify-center p-8 text-center text-sm">
                No messages in this conversation yet.
            </div>
        );
    }

    return (
        <ScrollArea className="flex min-h-0 flex-1 px-3">
            <div className="flex flex-col gap-3 py-4">
                {messages.map((m) => {
                    const mine = selfAccount !== null && m.from === selfAccount;
                    const pending = m.status === "pending";
                    const failed = m.status === "failed";

                    return (
                        <div
                            key={m.key}
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
                                    <span>
                                        {pending
                                            ? "Sending…"
                                            : failed
                                              ? "Failed"
                                              : ""}
                                    </span>
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
                })}
                <div ref={bottomRef} />
            </div>
        </ScrollArea>
    );
}
