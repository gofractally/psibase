import { ArrowLeft, Flag, MoreHorizontal, Reply, Trash } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatDate } from "@/apps/chainmail/utils";
import { Message } from "@/apps/chainmail/types";

interface MessageDetailProps {
    message: Message | null;
    onBack?: () => void;
}

export function MessageDetail({ message, onBack }: MessageDetailProps) {
    if (!message) return null;

    return (
        <div className="flex h-full w-full flex-col">
            {/* Header with back button on mobile */}
            <div className="flex items-center gap-2 border-b p-4">
                {onBack && (
                    <Button variant="ghost" size="icon" onClick={onBack}>
                        <ArrowLeft className="h-5 w-5" />
                    </Button>
                )}
                <h2 className="flex-1 text-lg font-semibold">
                    {message.subject}
                </h2>
                <div className="flex gap-1">
                    <Button variant="ghost" size="icon">
                        <Flag className="h-5 w-5" />
                    </Button>
                    <Button variant="ghost" size="icon">
                        <Trash className="h-5 w-5" />
                    </Button>
                    <Button variant="ghost" size="icon">
                        <MoreHorizontal className="h-5 w-5" />
                    </Button>
                </div>
            </div>

            {/* Message content */}
            <ScrollArea className="flex-1">
                <div className="p-4">
                    <div className="mb-6 flex items-start justify-between">
                        <div className="flex gap-3">
                            <Avatar className="h-10 w-10">
                                <div className="flex h-full w-full items-center justify-center bg-primary text-primary-foreground">
                                    {message.sender.name.charAt(0)}
                                </div>
                            </Avatar>
                            <div>
                                <p className="font-medium">
                                    {message.sender.name}
                                </p>
                                <p className="text-sm text-muted-foreground">
                                    {message.sender.email}
                                </p>
                                <p className="mt-1 text-xs text-muted-foreground">
                                    {formatDate(message.date)}
                                </p>
                            </div>
                        </div>
                        <Button variant="outline">
                            <Reply className="mr-2 h-4 w-4" />
                            Reply
                        </Button>
                    </div>

                    <div className="prose dark:prose-invert max-w-none">
                        {message.content.split("\n\n").map((paragraph, i) => (
                            <p key={i}>{paragraph}</p>
                        ))}
                    </div>
                </div>
            </ScrollArea>
        </div>
    );
}
