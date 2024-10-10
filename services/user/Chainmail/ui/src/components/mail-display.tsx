import type { Mailbox } from "src/types";

import { useEffect, useRef } from "react";
import { MilkdownProvider, useInstance } from "@milkdown/react";
import { ProsemirrorAdapterProvider } from "@prosemirror-adapter/react";
import { format } from "date-fns";
import { Archive, ArchiveRestore, Pin, Trash2 } from "lucide-react";
import { replaceAll } from "@milkdown/utils";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

import { Avatar, AvatarFallback, AvatarImage } from "@shadcn/avatar";
import { Button } from "@shadcn/button";
import { Separator } from "@shadcn/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@shadcn/tooltip";
import { ScrollArea } from "@shadcn/scroll-area";
import { Dialog } from "@shadcn/dialog";

import {
    ComposeDialog,
    EditSendDialogTriggerIconWithTooltip,
    MarkdownEditor,
    NoMessageSelected,
    ReplyDialogTriggerIconWithTooltip,
} from "@components";
import { Message, useDraftMessages, useIncomingMessages } from "@hooks";
import { getSupervisor } from "@lib/supervisor";
import { wait } from "@lib/utils";

export function MailDisplay({
    message,
    mailbox,
}: {
    message?: Message;
    mailbox: Mailbox;
}) {
    return (
        <div className="flex h-full max-h-full flex-col">
            {message ? (
                <>
                    <ActionBar mailbox={mailbox} message={message} />
                    <Separator />
                    <MessageHeader mailbox={mailbox} message={message} />
                    <Separator />
                    <ScrollArea className="flex-1">
                        <main className="mx-auto max-w-5xl">
                            {message ? (
                                <MilkdownProvider>
                                    <ProsemirrorAdapterProvider>
                                        <MessageBody message={message} />
                                    </ProsemirrorAdapterProvider>
                                </MilkdownProvider>
                            ) : null}
                        </main>
                    </ScrollArea>
                </>
            ) : (
                <NoMessageSelected>Select a message</NoMessageSelected>
            )}
        </div>
    );
}

const MessageBody = ({ message }: { message: Message }) => {
    const [_state, getEditor] = useInstance();

    const messageId = useRef<string>();
    useEffect(() => {
        if (message.id === messageId.current) return;
        const editor = getEditor();
        editor?.action(replaceAll(message.body));
    }, [message.id]);

    return (
        <MarkdownEditor
            initialValue={message.body ?? ""}
            updateMarkdown={() => {}}
            readOnly
        />
    );
};

const ActionBar = ({
    mailbox,
    message,
}: {
    mailbox: Mailbox;
    message: Message;
}) => {
    const queryClient = useQueryClient();
    const { setSelectedMessageId: setInboxMessageId } = useIncomingMessages();
    const {
        selectedMessage: selectedDraftMessage,
        setSelectedMessageId: setDraftMessageId,
        deleteDraftById,
    } = useDraftMessages();

    const onArchive = async (itemId: string) => {
        let id = parseInt(itemId);
        const supervisor = await getSupervisor();
        // TODO: Unsave if saved
        // await supervisor.functionCall({
        //     service: "chainmail",
        //     intf: "api",
        //     method: "unsave",
        //     params: [id],
        // });
        // TODO: Improve error detection. This promise resolves with success before the transaction is pushed.
        await supervisor.functionCall({
            service: "chainmail",
            intf: "api",
            method: "archive",
            params: [id],
        });
        setInboxMessageId("");
        toast.success("Your message has been archived");
        await wait(3000);
        queryClient.invalidateQueries({
            queryKey: ["incoming"],
        });
    };

    const onUnArchive = (itemId: string) => {
        toast.error("Not implemented");
    };

    const onSave = (itemId: string) => {
        toast.error("Not implemented");
    };

    const onDeleteDraft = () => {
        setDraftMessageId("");
        if (!selectedDraftMessage?.id) return;
        deleteDraftById(selectedDraftMessage.id);
        toast.success("Your draft has been deleted");
    };

    return (
        <div className="flex p-2">
            <div className="flex items-center gap-2">
                {mailbox === "inbox" ? (
                    <>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    disabled={!message}
                                    onClick={() => onArchive(message.msgId)}
                                >
                                    <Archive className="h-4 w-4" />
                                    <span className="sr-only">
                                        Archive message
                                    </span>
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>Archive message</TooltipContent>
                        </Tooltip>
                        {/* TODO: if the message is saved, do not show this. To un-save, the user should just archive it */}
                        {/* {message.saved ? ( */}
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    disabled={!message}
                                    onClick={() => onSave(message.msgId)}
                                >
                                    <Pin className="h-4 w-4" />
                                    <span className="sr-only">
                                        Keep message
                                    </span>
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>Keep message</TooltipContent>
                        </Tooltip>
                        {/* ) : (
                            null
                        )} */}
                    </>
                ) : null}
                {mailbox === "archived" ? (
                    <>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    disabled={!message}
                                    onClick={() => onUnArchive(message.msgId)}
                                >
                                    <ArchiveRestore className="h-4 w-4" />
                                    <span className="sr-only">
                                        Move to inbox
                                    </span>
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>Move to inbox</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    disabled={!message}
                                    onClick={() => onSave(message.msgId)}
                                >
                                    <Pin className="h-4 w-4" />
                                    <span className="sr-only">
                                        Keep message and move to inbox
                                    </span>
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                                Keep message and move to inbox
                            </TooltipContent>
                        </Tooltip>
                    </>
                ) : null}
                {mailbox === "drafts" ? (
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon"
                                disabled={!message}
                                onClick={onDeleteDraft}
                            >
                                <Trash2 className="h-4 w-4" />
                                <span className="sr-only">Delete draft</span>
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>Delete draft</TooltipContent>
                    </Tooltip>
                ) : null}
            </div>
            <div className="ml-auto flex items-center gap-2">
                <Dialog>
                    {mailbox === "drafts" ? (
                        <ComposeDialog
                            trigger={<EditSendDialogTriggerIconWithTooltip />}
                            message={message}
                        />
                    ) : (
                        <ComposeDialog
                            trigger={<ReplyDialogTriggerIconWithTooltip />}
                            message={message}
                        />
                    )}
                </Dialog>
                {/* <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon"
                            disabled={!message}
                            asChild
                        >
                            <Link to={`/posts/${message!.id}`}>
                                <Maximize2 className="h-4 w-4" />
                                <span className="sr-only">Full screen</span>
                            </Link>
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>Full screen</TooltipContent>
                </Tooltip> */}
            </div>
            {/* <div className="flex items-center gap-2">
                <Separator orientation="vertical" className="mx-2 h-6" />
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" disabled={!message}>
                            <MoreVertical className="h-4 w-4" />
                            <span className="sr-only">More</span>
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        <DropdownMenuItem>Mark as unread</DropdownMenuItem>
                        <DropdownMenuItem>Star thread</DropdownMenuItem>
                        <DropdownMenuItem>Add label</DropdownMenuItem>
                        <DropdownMenuItem>Mute thread</DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div> */}
        </div>
    );
};

const MessageHeader = ({
    mailbox,
    message,
}: {
    mailbox: Mailbox;
    message: Message;
}) => {
    const account = mailbox === "inbox" ? message.from : message.to;

    return (
        <div className="flex items-center gap-4 p-4 text-sm">
            <Avatar>
                <AvatarImage alt={account} />
                <AvatarFallback>{account[0]}</AvatarFallback>
            </Avatar>
            <div className="flex-1">
                <h2 className="text-xl font-bold">{message.subject}</h2>
                <p className="text-sm text-muted-foreground">
                    {mailbox === "inbox" ? "From " : "To "}
                    <Tooltip delayDuration={700}>
                        <TooltipTrigger asChild>
                            <span>{account}</span>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">
                            {message.from}
                        </TooltipContent>
                    </Tooltip>{" "}
                    • {format(new Date(message.datetime), "PPp")}
                </p>
            </div>
        </div>
    );
};
