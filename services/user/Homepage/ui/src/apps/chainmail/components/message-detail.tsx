import type { DraftMessage, Mailbox, Message } from "@/apps/chainmail/types";

import { ArrowLeft, Trash2 } from "lucide-react";
import { toast } from "@shared/shadcn/ui/sonner";

import { Avatar } from "@shared/shadcn/ui/avatar";
import { Button } from "@shared/shadcn/ui/button";
import { ScrollArea } from "@shared/shadcn/ui/scroll-area";
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@shared/shadcn/ui/tooltip";

// import { AwaitTime } from "@/globals";
// import { wait } from "@/lib/wait";

import {
    // useArchiveMessage,
    useDraftMessages,
    // useIncomingMessages,
    // useInvalidateMailboxQueries,
    // useSaveMessage,
} from "@/apps/chainmail/hooks";
import { formatDate } from "@/apps/chainmail/utils";

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
    // const invalidateMailboxQueries = useInvalidateMailboxQueries();

    // const { setSelectedMessageId: setInboxMessageId } = useIncomingMessages();
    // const { mutateAsync: archiveMessage } = useArchiveMessage();
    // const { mutateAsync: saveMessage } = useSaveMessage();

    // const onArchive = async (message: Message) => {
    //     if (message.type === "outgoing") {
    //         return toast.error(
    //             "Archiving sent messages is currently not supported.",
    //         );
    //     }

    //     const loadingId = toast.loading("Archiving message");

    //     try {
    //         // TODO: Improve error detection. This promise resolves with success before the transaction is pushed.
    //         await archiveMessage(message.msgId);
    //         setInboxMessageId("");
    //         toast.success("Your message has been archived");
    //         await wait(AwaitTime);
    //         invalidateMailboxQueries();
    //     } catch (error) {
    //         toast.error("There was a problem archiving this message.");
    //     } finally {
    //         toast.dismiss(loadingId);
    //     }
    // };

    // const onUnArchive = async (itemId: string) => {
    //     toast.error("Not implemented");
    // };

    // const onSave = async (message: Message) => {
    //     if (message.type === "outgoing") {
    //         return toast.error(
    //             "Saving sent messages is currently not supported.",
    //         );
    //     }

    //     const loadingId = toast.loading("Saving message");

    //     try {
    //         await saveMessage(message.msgId);
    //         toast.success("This message will be kept");
    //         await wait(AwaitTime);
    //         invalidateMailboxQueries();
    //     } catch (error) {
    //         toast.error("There was a problem. Your message was not saved.");
    //     } finally {
    //         toast.dismiss(loadingId);
    //     }
    // };
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
                    {/* {(mailbox === "inbox" || mailbox === "saved") && (
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
                    )} */}
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

                    <article className="prose max-w-none dark:prose-invert">
                        {message.body.split("\n\n").map((paragraph, i) => (
                            <p key={i}>{paragraph}</p>
                        ))}
                    </article>
                </div>
            </ScrollArea>
        </div>
    );
}
