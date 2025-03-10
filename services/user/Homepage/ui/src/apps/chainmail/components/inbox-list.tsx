import { Avatar } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatDistanceToNow } from "@/apps/chainmail/utils";
import { Message } from "@/apps/chainmail/types";

interface InboxListProps {
    messages: Message[];
    selectedId: string | null;
    onSelectMessage: (id: string) => void;
}

export function InboxList({
    messages,
    selectedId,
    onSelectMessage,
}: InboxListProps) {
    return (
        <ScrollArea className="h-full w-full">
            <div className="divide-y">
                {messages.map((message) => (
                    <div
                        key={message.id}
                        className={`flex cursor-pointer gap-4 p-4 transition-colors hover:bg-muted ${
                            selectedId === message.id ? "bg-muted" : ""
                        }`}
                        onClick={() => onSelectMessage(message.id)}
                    >
                        <Avatar className="h-10 w-10">
                            <div className="flex h-full w-full items-center justify-center bg-primary text-primary-foreground">
                                {message.sender.name.charAt(0)}
                            </div>
                        </Avatar>
                        <div className="flex-1 space-y-1 overflow-hidden">
                            <div className="flex items-center justify-between">
                                <p className="font-medium">
                                    {message.sender.name}
                                </p>
                                <span className="text-xs text-muted-foreground">
                                    {formatDistanceToNow(message.date)}
                                </span>
                            </div>
                            <p className="text-sm font-medium">
                                {message.subject}
                            </p>
                            <p className="truncate text-sm text-muted-foreground">
                                {message.preview}
                            </p>
                        </div>
                    </div>
                ))}
            </div>
        </ScrollArea>
    );
}
