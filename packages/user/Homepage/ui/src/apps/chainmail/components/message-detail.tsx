import type { DraftMessage, Mailbox, Message } from "@/apps/chainmail/types";

import { ArrowLeft, Trash2 } from "lucide-react";

import { useDraftMessages } from "@/apps/chainmail/hooks/use-mail";
import { formatDate } from "@/apps/chainmail/utils";

import { Avatar } from "@shared/components/avatar";
import { Button } from "@shared/shadcn/ui/button";
import { ScrollArea } from "@shared/shadcn/ui/scroll-area";
import { Separator } from "@shared/shadcn/ui/separator";
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

    const primaryAccount = mailbox === "inbox" ? message.from : message.to;

    const onDeleteDraft = () => {
        setDraftMessageId("");
        if (!selectedDraftMessage?.id) return;
        deleteDraftById(selectedDraftMessage.id);
        toast.success("Your draft has been deleted");
    };

    return (
        <div className="flex h-full w-full min-h-0 flex-col">
            <div className="border-border flex items-center gap-2 border-b px-4 py-3">
                {onBack ? (
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={onBack}
                        aria-label="Back to message list"
                    >
                        <ArrowLeft className="size-5" />
                    </Button>
                ) : null}
                <h2 className="min-w-0 flex-1 truncate text-lg font-semibold tracking-tight">
                    {message.subject || "(No subject)"}
                </h2>
                <div className="flex shrink-0 gap-1">
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
                                        aria-label="Delete draft"
                                    >
                                        <Trash2 className="size-5" />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>Delete draft</TooltipContent>
                            </Tooltip>
                        </>
                    ) : null}
                </div>
            </div>

            <ScrollArea className="min-h-0 flex-1">
                <div className="space-y-6 p-4 sm:p-6">
                    <div className="flex items-start justify-between gap-4">
                        <div className="flex min-w-0 gap-3">
                            <Avatar
                                account={primaryAccount}
                                className="size-10 shrink-0"
                                alt={`${primaryAccount} avatar`}
                            />
                            <div className="min-w-0 space-y-1">
                                <div className="space-y-0.5 text-sm">
                                    <p>
                                        <span className="text-muted-foreground">
                                            From{" "}
                                        </span>
                                        <span className="font-medium">
                                            {message.from}
                                        </span>
                                    </p>
                                    <p>
                                        <span className="text-muted-foreground">
                                            To{" "}
                                        </span>
                                        <span className="font-medium">
                                            {message.to}
                                        </span>
                                    </p>
                                </div>
                                <p className="text-muted-foreground text-xs">
                                    {formatDate(message.datetime)}
                                </p>
                            </div>
                        </div>
                        {mailbox !== "drafts" && mailbox !== "sent" ? (
                            <ComposeDialog
                                trigger={<ReplyDialogTrigger />}
                                message={message}
                            />
                        ) : null}
                    </div>

                    <Separator />

                    <article className="prose dark:prose-invert max-w-none text-sm leading-relaxed whitespace-pre-wrap">
                        {message.body || (
                            <span className="text-muted-foreground italic">
                                No message body
                            </span>
                        )}
                    </article>
                </div>
            </ScrollArea>
        </div>
    );
}
