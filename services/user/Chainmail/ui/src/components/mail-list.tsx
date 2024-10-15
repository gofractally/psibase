import type { Mailbox } from "src/types";

import { formatDistanceToNow } from "date-fns";
import { Pin } from "lucide-react";

import { cn } from "@lib/utils";
import { ScrollArea } from "@shadcn/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@shadcn/tooltip";
import { type Message } from "@hooks";

interface SharedProps {
    mailbox: Mailbox;
    selectedMessage?: Message;
    setSelectedMessageId: (id: string) => void;
}

interface MailListProps extends SharedProps {
    messages: Message[];
}

export function MailList({
    mailbox,
    messages,
    selectedMessage,
    setSelectedMessageId,
}: MailListProps) {
    return (
        <ScrollArea className="h-screen">
            <div className="flex flex-1 flex-col gap-2 p-4 pt-0">
                {messages
                    ?.sort((a, b) => b.datetime - a.datetime)
                    .map((item) => (
                        <MailItem
                            key={item.id}
                            mailbox={mailbox}
                            item={item}
                            setSelectedMessageId={setSelectedMessageId}
                            selectedMessage={selectedMessage}
                        />
                    ))}
            </div>
        </ScrollArea>
    );
}

interface MailItemProps extends SharedProps {
    item: Message;
}

const MailItem = ({
    mailbox,
    item,
    selectedMessage,
    setSelectedMessageId,
}: MailItemProps) => {
    return (
        <div
            key={item.id}
            className={cn(
                "flex cursor-pointer flex-col items-start gap-2 rounded-lg border p-3 text-left text-sm transition-all hover:bg-accent",
                selectedMessage?.id === item.id && "bg-muted",
            )}
            onClick={() => {
                setSelectedMessageId(item.id);
            }}
        >
            <div className="flex w-full flex-col gap-1">
                <div className="flex items-center">
                    <div className="flex items-center gap-2">
                        {item.from && item.to ? (
                            <Tooltip>
                                <TooltipTrigger>
                                    <div className="font-semibold">
                                        {mailbox === "inbox"
                                            ? item.from
                                            : `To: ${item.to}`}
                                    </div>
                                </TooltipTrigger>
                                <TooltipContent side="right">
                                    {item.from}
                                </TooltipContent>
                            </Tooltip>
                        ) : null}
                    </div>
                    <div
                        className={cn(
                            "ml-auto flex items-center justify-center gap-2",
                            selectedMessage?.id === item.id
                                ? "text-foreground"
                                : "text-muted-foreground",
                        )}
                    >
                        <p className="text-xs">
                            {formatDistanceToNow(new Date(item.datetime), {
                                addSuffix: true,
                            })}
                        </p>
                        {/* TODO: If message is saved, display a pin here */}
                        {/* {item.saved ? (
                            <Pin size={14} className="mt-0.5" />
                        ) : null} */}
                    </div>
                </div>
                <div className="text-xs font-medium">{item.subject}</div>
            </div>
            <div className="line-clamp-2 text-xs text-muted-foreground">
                {item.body.substring(0, 300)}
            </div>
        </div>
    );
};
