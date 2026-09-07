import type { DraftMessage, Mailbox, Message } from "@/apps/chainmail/types";

import { ArrowLeft, Trash2 } from "lucide-react";

import { useDraftMessages } from "@/apps/chainmail/hooks/use-mail";
import { formatDate } from "@/apps/chainmail/utils";

import { Avatar } from "@shared/components/avatar";
import { Button } from "@shared/shadcn/ui/button";
import { ScrollArea } from "@shared/shadcn/ui/scroll-area";
import { toast } from "@shared/shadcn/ui/sonner";
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@shared/shadcn/ui/tooltip";

import {
    ComposeDialog,
    EditSendDialogTrigger,
    ReplyDialogTrigger,
} from "./compose-dialog";

interface MessageDetailProps {
    message: Message | DraftMessage | null;
    mailbox: Mailbox;
    onBack?: () => void;
}

export function MessageDetail({
    message,
    mailbox,
    onBack,
}: MessageDetailProps) {
    const {
        selectedMessage: selectedDraftMessage,
        setSelectedMessageId: setDraftMessageId,
        deleteDraftById,
    } = useDraftMessages();

    if (!message) return null;

    const account = mailbox === "inbox" ? message.from : message.to;

    const onDeleteDraft = () => {
        setDraftMessageId("");
        if (!selectedDraftMessage?.id) return;
        deleteDraftById(selectedDraftMessage.id);
        toast.success("Your draft has been deleted");
    };

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
                    {mailbox === "drafts" ? (
                        <>
                            <ComposeDialog
                                trigger={<EditSendDialogTrigger />}
                                message={message}
                            />
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        disabled={!message}
                                        onClick={onDeleteDraft}
                                    >
                                        <Trash2 className="h-5 w-5" />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>Delete draft</TooltipContent>
                            </Tooltip>
                        </>
                    ) : null}
                </div>
            </div>

            {/* Message content */}
            <ScrollArea className="flex-1">
                <div className="p-4">
                    <div className="mb-6 flex items-start justify-between">
                        <div className="flex gap-3">
                            <Avatar
                                account={account}
                                className="h-10 w-10"
                                alt={`${account} avatar`}
                            />
                            <div>
                                <p className="font-medium">{account}</p>
                                <p className="text-muted-foreground mt-1 text-xs">
                                    {formatDate(message.datetime)}
                                </p>
                            </div>
                        </div>
                        {mailbox !== "drafts" && mailbox !== "sent" && (
                            <ComposeDialog
                                trigger={<ReplyDialogTrigger />}
                                message={message}
                            />
                        )}
                    </div>

                    <article className="prose dark:prose-invert max-w-none">
                        {message.body.split("\n\n").map((paragraph, i) => (
                            <p key={i}>{paragraph}</p>
                        ))}
                    </article>
                </div>
            </ScrollArea>
        </div>
    );
}
