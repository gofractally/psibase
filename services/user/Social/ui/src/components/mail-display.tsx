import { useEffect, useRef } from "react";
import { MilkdownProvider, useInstance } from "@milkdown/react";
import { ProsemirrorAdapterProvider } from "@prosemirror-adapter/react";
import { format } from "date-fns";
import { Reply, Trash2 } from "lucide-react";
import { replaceAll } from "@milkdown/utils";

import { Avatar, AvatarFallback, AvatarImage } from "@shadcn/avatar";
import { Button } from "@shadcn/button";
import { Separator } from "@shadcn/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@shadcn/tooltip";
import { ScrollArea } from "@shadcn/scroll-area";

import {
    ComposeDialog,
    MarkdownEditor,
    ReplyDialogTriggerIconWithTooltip,
} from "@components";
import { Message, useLocalMail, useLocalStorage } from "@hooks";

import { accounts } from "../fixtures/data";
import { Dialog } from "@shadcn/dialog";

export function MailDisplay() {
    const [_messages, selectedMessage] = useLocalMail();

    if (!selectedMessage) return null;

    return (
        <div className="flex h-full max-h-full flex-col">
            {selectedMessage ? (
                <>
                    <ActionBar message={selectedMessage} />
                    <Separator />
                    <MessageHeader message={selectedMessage} />
                    <Separator />
                    <ScrollArea className="flex-1">
                        <main className="mx-auto max-w-5xl">
                            {selectedMessage ? (
                                <MilkdownProvider>
                                    <ProsemirrorAdapterProvider>
                                        <MessageBody
                                            message={selectedMessage}
                                        />
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

const ActionBar = ({ message }: { message: Message }) => {
    const [_, __, setSelectedMessageId] = useLocalMail();
    const [messages, setMessages, getMessages] = useLocalStorage<Message[]>(
        "messages",
        [],
    );

    const onDelete = () => {
        const allMessages = getMessages() ?? [];
        const newMessages = allMessages.filter((m) => m.id !== message.id);
        setSelectedMessageId("");
        setMessages(newMessages);
    };

    // const today = new Date();
    return (
        <div className="flex p-2">
            <div className="flex items-center gap-2">
                {/* <Tooltip>
                    <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" disabled={!message}>
                            <Archive className="h-4 w-4" />
                            <span className="sr-only">Archive</span>
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>Archive</TooltipContent>
                </Tooltip>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" disabled={!message}>
                            <ArchiveX className="h-4 w-4" />
                            <span className="sr-only">Move to junk</span>
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>Move to junk</TooltipContent>
                </Tooltip> */}
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
                {/* <Separator orientation="vertical" className="mx-1 h-6" /> */}
                {/* <Tooltip>
                    <Popover>
                        <PopoverTrigger asChild>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    disabled={!message}
                                >
                                    <Clock className="h-4 w-4" />
                                    <span className="sr-only">Snooze</span>
                                </Button>
                            </TooltipTrigger>
                        </PopoverTrigger>
                        <PopoverContent className="flex w-[535px] p-0">
                            <div className="flex flex-col gap-2 border-r px-2 py-4">
                                <div className="px-4 text-sm font-medium">
                                    Snooze until
                                </div>
                                <div className="grid min-w-[250px] gap-1">
                                    <Button
                                        variant="ghost"
                                        className="justify-start font-normal"
                                    >
                                        Later today{" "}
                                        <span className="ml-auto text-muted-foreground">
                                            {format(
                                                addHours(today, 4),
                                                "E, h:m b",
                                            )}
                                        </span>
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        className="justify-start font-normal"
                                    >
                                        Tomorrow
                                        <span className="ml-auto text-muted-foreground">
                                            {format(
                                                addDays(today, 1),
                                                "E, h:m b",
                                            )}
                                        </span>
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        className="justify-start font-normal"
                                    >
                                        This weekend
                                        <span className="ml-auto text-muted-foreground">
                                            {format(
                                                nextSaturday(today),
                                                "E, h:m b",
                                            )}
                                        </span>
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        className="justify-start font-normal"
                                    >
                                        Next week
                                        <span className="ml-auto text-muted-foreground">
                                            {format(
                                                addDays(today, 7),
                                                "E, h:m b",
                                            )}
                                        </span>
                                    </Button>
                                </div>
                            </div>
                            <div className="p-2">
                                <Calendar />
                            </div>
                        </PopoverContent>
                    </Popover>
                    <TooltipContent>Snooze</TooltipContent>
                </Tooltip> */}
            </div>
            <div className="ml-auto flex items-center gap-2">
                <Dialog>
                    <ComposeDialog
                        trigger={<ReplyDialogTriggerIconWithTooltip />}
                        inReplyTo={message.id}
                    />
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

const MessageHeader = ({ message }: { message: Message }) => {
    const account = accounts.find((a) => a.account === message.from);
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
                    From{" "}
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

// const Comments = ({ mail }: { mail: Mail }) => {
//     return (
//         <div className="p-4">
//             <h3 className="mb-4 text-lg font-bold">Comments</h3>
//             <div className="space-y-4">
//                 {mail.comments.map((comment) => (
//                     <div
//                         className="flex items-start space-x-2"
//                         key={comment.id}
//                     >
//                         <Avatar className="scale-[85%] border">
//                             <AvatarImage alt={comment.name} />
//                             <AvatarFallback className="bg-white">
//                                 {comment.name
//                                     .split(" ")
//                                     .map((chunk) => chunk[0])
//                                     .join("")}
//                             </AvatarFallback>
//                         </Avatar>
//                         <div className="flex-1">
//                             <h4 className="text-sm font-semibold">
//                                 {comment.name}
//                             </h4>
//                             <p className="text-xs text-muted-foreground">
//                                 {comment.text}
//                             </p>
//                         </div>
//                     </div>
//                 ))}
//             </div>
//         </div>
//     );
// };

// const CommentForm = () => {
//     return (
//         <form className="p-4">
//             <div className="grid gap-4">
//                 <Textarea className="p-4" placeholder="Add comment" />
//                 <div className="flex items-center">
//                     <Button
//                         onClick={(e) => e.preventDefault()}
//                         size="sm"
//                         className="ml-auto"
//                     >
//                         Send
//                     </Button>
//                 </div>
//             </div>
//         </form>
//     );
// };
