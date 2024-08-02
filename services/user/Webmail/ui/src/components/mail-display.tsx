import type { Mailbox } from "src/types";

import { useEffect, useRef } from "react";
import { MilkdownProvider, useInstance } from "@milkdown/react";
import { ProsemirrorAdapterProvider } from "@prosemirror-adapter/react";
import { format } from "date-fns";
import { Trash2 } from "lucide-react";
import { replaceAll } from "@milkdown/utils";

import { Avatar, AvatarFallback, AvatarImage } from "@shadcn/avatar";
import { Button } from "@shadcn/button";
import { Separator } from "@shadcn/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@shadcn/tooltip";
import { ScrollArea } from "@shadcn/scroll-area";

import {
    ComposeDialog,
    EditSendDialogTriggerIconWithTooltip,
    MarkdownEditor,
    ReplyDialogTriggerIconWithTooltip,
} from "@components";
import { Message, useDraftMessages, useIncomingMessages } from "@hooks";

import { accounts } from "../fixtures/data";
import { Dialog } from "@shadcn/dialog";

export function MailDisplay({
    message,
    mailbox,
}: {
    message?: Message;
    mailbox: Mailbox;
}) {
    if (!message) return null;

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
                <div className="flex flex-1 items-center justify-center text-muted-foreground">
                    No post selected
                </div>
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
    const { setSelectedMessageId: setInboxMessageId } = useIncomingMessages();
    const {
        selectedMessage: selectedDraftMessage,
        setSelectedMessageId: setDraftMessageId,
        deleteDraftById,
    } = useDraftMessages();

    const onDelete = () => {
        if (mailbox === "inbox") {
            setInboxMessageId("");
        } else if (mailbox === "drafts") {
            setDraftMessageId("");
            if (!selectedDraftMessage?.id) return;
            deleteDraftById(selectedDraftMessage.id);
        }
    };

    return (
        <div className="flex p-2">
            <div className="flex items-center gap-2">
                {mailbox !== "sent" ? (
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon"
                                disabled={!message}
                                onClick={onDelete}
                            >
                                <Trash2 className="h-4 w-4" />
                                <span className="sr-only">Move to trash</span>
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>Move to trash</TooltipContent>
                    </Tooltip>
                ) : null}
            </div>
            <div className="ml-auto flex items-center gap-2">
                <Dialog>
                    {mailbox === "drafts" ? (
                        <ComposeDialog
                            trigger={<EditSendDialogTriggerIconWithTooltip />}
                            inReplyTo={message.id}
                        />
                    ) : (
                        <ComposeDialog
                            trigger={<ReplyDialogTriggerIconWithTooltip />}
                            inReplyTo={message.id}
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
    const fromAccount = accounts.find((a) => a.account === message.from);
    const toAccount = accounts.find((a) => a.account === message.to);

    const account = mailbox === "inbox" ? fromAccount : toAccount;

    return (
        <div className="flex items-center gap-4 p-4 text-sm">
            <Avatar>
                <AvatarImage alt={account?.name} />
                <AvatarFallback>
                    {account?.name
                        .split(" ")
                        .map((chunk) => chunk[0])
                        .join("")}
                </AvatarFallback>
            </Avatar>
            <div className="flex-1">
                <h2 className="text-xl font-bold">{message.subject}</h2>
                <p className="text-sm text-muted-foreground">
                    {mailbox === "inbox" ? "From " : "To "}
                    <Tooltip delayDuration={700}>
                        <TooltipTrigger asChild>
                            <span>{account?.name}</span>
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
