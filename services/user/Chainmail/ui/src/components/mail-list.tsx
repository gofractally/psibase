import type { Mailbox } from "src/types";

import { formatDistanceToNow } from "date-fns";

import { cn } from "@lib/utils";
import { ScrollArea } from "@shadcn/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@shadcn/tooltip";
import { Archive } from "lucide-react";
import { Button } from "@shadcn/button";
import { type Message } from "@hooks";
import { toast } from "sonner";
import { getSupervisor } from "@lib/supervisor";

interface SharedProps {
    mailbox: Mailbox;
    selectedMessage?: Message;
    setSelectedMessageId: (id: string) => void;
}

interface MailListProps extends SharedProps {
    messages: Message[];
}

const onArchive = async (itemId: string) => {
    console.info(`onArchive.top(itemid[${itemId}])`);
    let id = parseInt(itemId);
    const supervisor = await getSupervisor();
    // TODO: Improve error detection. This promise resolves with success before the transaction is pushed.
    await supervisor.functionCall({
        service: "chainmail",
        intf: "api",
        method: "archive",
        params: [id],
    });
    toast.success("Your message has been archived");
};

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
                console.info(item);
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
                        {/* {!item.read && (
                                        <span className="flex h-2 w-2 rounded-full bg-blue-600" />
                                    )} */}
                    </div>
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => onArchive(item.msgId)}
                    >
                        <Archive className="h-4 w-4" />
                        <span className="sr-only">Archive</span>
                    </Button>
                    <div
                        className={cn(
                            "ml-auto text-xs",
                            selectedMessage?.id === item.id
                                ? "text-foreground"
                                : "text-muted-foreground",
                        )}
                    >
                        {formatDistanceToNow(new Date(item.datetime), {
                            addSuffix: true,
                        })}
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
