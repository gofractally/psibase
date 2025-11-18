import type { DraftMessage, Mailbox, Message } from "@/apps/chainmail/types";

import { formatDistanceToNow } from "@/apps/chainmail/utils";

import { Loading } from "@/components/loading";

import { Avatar } from "@shared/shadcn/ui/avatar";
import { ScrollArea } from "@shared/shadcn/ui/scroll-area";

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

export function MailList({
    mailbox,
    messages,
    selectedMessage,
    onSelectMessage,
    isLoading,
}: MailListProps) {
    if (isLoading) {
        return <Loading />;
    }

    if (messages.length === 0) {
        return <EmptyBox>No messages</EmptyBox>;
    }

    return (
        <ScrollArea className="h-full w-full">
            <div className="divide-y">
                {messages
                    .sort((a, b) => b.datetime - a.datetime)
                    .map((message) => (
                        <div
                            key={message.id}
                            className={`hover:bg-muted flex cursor-pointer gap-4 p-4 transition-colors ${
                                selectedMessage?.id === message.id
                                    ? "bg-muted"
                                    : ""
                            }`}
                            onClick={() => onSelectMessage(message.id)}
                        >
                            {mailbox !== "sent" && !!message.from ? (
                                <Avatar className="h-10 w-10 flex-shrink-0">
                                    <div className="bg-primary text-primary-foreground flex h-full w-full items-center justify-center">
                                        {message.from.charAt(0)}
                                    </div>
                                </Avatar>
                            ) : null}
                            <div className="min-w-0 flex-1 space-y-1">
                                <div className="flex items-center justify-between">
                                    <p className="truncate font-medium">
                                        {mailbox === "inbox"
                                            ? message.from
                                            : `To: ${message.to}`}
                                    </p>
                                    <span className="text-muted-foreground ml-2 whitespace-nowrap text-xs">
                                        {formatDistanceToNow(message.datetime)}
                                    </span>
                                </div>
                                <p className="truncate text-sm font-medium">
                                    {message.subject}
                                </p>
                                <p className="text-muted-foreground line-clamp-2 text-sm">
                                    {message.body.substring(0, 300)}
                                </p>
                            </div>
                        </div>
                    ))}
            </div>
        </ScrollArea>
    );
}
