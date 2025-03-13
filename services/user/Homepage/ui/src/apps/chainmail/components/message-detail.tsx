import type { Message } from "@/apps/chainmail/hooks";
import type { Mailbox } from "@/apps/chainmail/types";

import { Archive, ArrowLeft, Pin, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { supervisor } from "@/supervisor";

import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@/components/ui/tooltip";

import { wait } from "@/lib/wait";

import {
    useDraftMessages,
    useIncomingMessages,
    useInvalidateMailboxQueries,
} from "@/apps/chainmail/hooks";
import { formatDate } from "@/apps/chainmail/utils";

import {
    ComposeDialog,
    EditSendDialogTrigger,
    ReplyDialogTrigger,
} from "./compose-dialog";

interface MessageDetailProps {
    message: Message | null;
    mailbox: Mailbox;
    onBack?: () => void;
}

export function MessageDetail({
    message,
    mailbox,
    onBack,
}: MessageDetailProps) {
    if (!message) return null;

    const invalidateMailboxQueries = useInvalidateMailboxQueries();

    const account = mailbox === "inbox" ? message.from : message.to;

    const { setSelectedMessageId: setInboxMessageId } = useIncomingMessages();
    const {
        selectedMessage: selectedDraftMessage,
        setSelectedMessageId: setDraftMessageId,
        deleteDraftById,
    } = useDraftMessages();

    const onArchive = async (message: Message) => {
        if (message.type === "outgoing") {
            return toast.error(
                "Archiving sent messages is currently not supported.",
            );
        }
        try {
            // TODO: Improve error detection. This promise resolves with success before the transaction is pushed.
            await supervisor.functionCall({
                service: "chainmail",
                intf: "api",
                method: "archive",
                params: [parseInt(message.msgId)],
            });
            setInboxMessageId("");
            toast.success("Your message has been archived");
            await wait(3000);
            invalidateMailboxQueries();
        } catch (error) {
            toast.error("There was a problem archiving this message.");
        }
    };

    const onUnArchive = async (itemId: string) => {
        toast.error("Not implemented");
    };

    const onSave = async (message: Message) => {
        if (message.type === "outgoing") {
            return toast.error(
                "Saving sent messages is currently not supported.",
            );
        }
        try {
            await supervisor.functionCall({
                service: "chainmail",
                intf: "api",
                method: "save",
                params: [parseInt(message.msgId)],
            });
            toast.success("This message will be kept");
            await wait(3000);
            invalidateMailboxQueries();
        } catch (error) {
            toast.error("There was a problem. Your message was not saved.");
        }
    };

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
                    {(mailbox === "inbox" || mailbox === "saved") && (
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    disabled={!message}
                                    onClick={() => onArchive(message)}
                                >
                                    <Archive className="h-5 w-5" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>Archive message</TooltipContent>
                        </Tooltip>
                    )}
                    {(mailbox === "inbox" || mailbox === "archived") && (
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    disabled={!message}
                                    onClick={() => onSave(message)}
                                >
                                    <Pin className="h-5 w-5" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                                Keep message and move to Saved mailbox
                            </TooltipContent>
                        </Tooltip>
                    )}
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
                            <Avatar className="h-10 w-10">
                                <div className="flex h-full w-full items-center justify-center bg-primary text-primary-foreground">
                                    {account.charAt(0)}
                                </div>
                            </Avatar>
                            <div>
                                <p className="font-medium">{account}</p>
                                <p className="mt-1 text-xs text-muted-foreground">
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

                    <div className="prose dark:prose-invert max-w-none">
                        {message.body.split("\n\n").map((paragraph, i) => (
                            <p key={i}>{paragraph}</p>
                        ))}
                    </div>
                </div>
            </ScrollArea>
        </div>
    );
}
