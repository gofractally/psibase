import { addDays, addHours, format, nextSaturday } from "date-fns";
import {
    Archive,
    ArchiveX,
    Clock,
    MoreVertical,
    Reply,
    Maximize2,
    Trash2,
} from "lucide-react";

import {
    DropdownMenuContent,
    DropdownMenuItem,
} from "../shad/components/ui/dropdown-menu";
import {
    Avatar,
    AvatarFallback,
    AvatarImage,
} from "../shad/components/ui/avatar";
import { Button } from "../shad/components/ui/button";
import { Calendar } from "../shad/components/ui/calendar";
import {
    DropdownMenu,
    DropdownMenuTrigger,
} from "../shad/components/ui/dropdown-menu";
import { Label } from "../shad/components/ui/label";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "../shad/components/ui/popover";
import { Separator } from "../shad/components/ui/separator";
import { Textarea } from "../shad/components/ui/textarea";
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "../shad/components/ui/tooltip";
import { Mail } from "../fixtures/data";
import { ScrollArea } from "@shadcn/scroll-area";
import { Link } from "react-router-dom";

interface MailDisplayProps {
    mail: Mail | null;
}

export function MailDisplay({ mail }: MailDisplayProps) {
    return (
        <div className="flex h-full max-h-full flex-col">
            {mail ? (
                <>
                    <ActionBar mail={mail} />
                    <Separator />
                    <PostHeader mail={mail} />
                    <Separator />
                    <ScrollArea className="flex-1">
                        <article className="prose max-w-none p-4">
                            {mail.text}
                        </article>
                        <Separator />
                        <Comments mail={mail} />
                    </ScrollArea>
                    <Separator />
                    <CommentForm />
                </>
            ) : (
                <div className="flex flex-1 items-center justify-center text-muted-foreground">
                    No post selected
                </div>
            )}
        </div>
    );
}

const ActionBar = ({ mail }: MailDisplayProps) => {
    const today = new Date();
    return (
        <div className="flex p-2">
            <div className="flex items-center gap-2">
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" disabled={!mail}>
                            <Archive className="h-4 w-4" />
                            <span className="sr-only">Archive</span>
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>Archive</TooltipContent>
                </Tooltip>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" disabled={!mail}>
                            <ArchiveX className="h-4 w-4" />
                            <span className="sr-only">Move to junk</span>
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>Move to junk</TooltipContent>
                </Tooltip>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" disabled={!mail}>
                            <Trash2 className="h-4 w-4" />
                            <span className="sr-only">Move to trash</span>
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>Move to trash</TooltipContent>
                </Tooltip>
                <Separator orientation="vertical" className="mx-1 h-6" />
                <Tooltip>
                    <Popover>
                        <PopoverTrigger asChild>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    disabled={!mail}
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
                </Tooltip>
            </div>
            <div className="ml-auto flex items-center gap-2">
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" disabled={!mail}>
                            <Reply className="h-4 w-4" />
                            <span className="sr-only">Reply</span>
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>Reply</TooltipContent>
                </Tooltip>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon"
                            disabled={!mail}
                            asChild
                        >
                            <Link to={`/posts/${mail!.id}`}>
                                <Maximize2 className="h-4 w-4" />
                                <span className="sr-only">Full screen</span>
                            </Link>
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>Full screen</TooltipContent>
                </Tooltip>
            </div>
            <Separator orientation="vertical" className="mx-2 h-6" />
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" disabled={!mail}>
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
        </div>
    );
};

const PostHeader = ({ mail }: { mail: Mail }) => {
    return (
        <div className="flex items-center gap-4 p-4 text-sm">
            <Avatar>
                <AvatarImage alt={mail.name} />
                <AvatarFallback>
                    {mail.name
                        .split(" ")
                        .map((chunk) => chunk[0])
                        .join("")}
                </AvatarFallback>
            </Avatar>
            <div className="flex-1">
                <h2 className="text-xl font-bold">{mail.subject}</h2>
                <p className="text-sm text-muted-foreground">
                    By{" "}
                    <Tooltip delayDuration={700}>
                        <TooltipTrigger asChild>
                            <span>{mail.name}</span>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">
                            {mail.email}
                        </TooltipContent>
                    </Tooltip>{" "}
                    • {format(new Date(mail.date), "PPp")}
                </p>
            </div>
        </div>
    );
};

const Comments = ({ mail }: { mail: Mail }) => {
    return (
        <div className="p-4">
            <h3 className="mb-4 text-lg font-bold">Comments</h3>
            <div className="space-y-4">
                {mail.comments.map((comment) => (
                    <div
                        className="flex items-start space-x-2"
                        key={comment.id}
                    >
                        <Avatar className="scale-[85%] border">
                            <AvatarImage alt={comment.name} />
                            <AvatarFallback className="bg-white">
                                {comment.name
                                    .split(" ")
                                    .map((chunk) => chunk[0])
                                    .join("")}
                            </AvatarFallback>
                        </Avatar>
                        <div className="flex-1">
                            <h4 className="text-sm font-semibold">
                                {comment.name}
                            </h4>
                            <p className="text-xs text-muted-foreground">
                                {comment.text}
                            </p>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

const CommentForm = () => {
    return (
        <form className="p-4">
            <div className="grid gap-4">
                <Textarea className="p-4" placeholder="Add comment" />
                <div className="flex items-center">
                    <Button
                        onClick={(e) => e.preventDefault()}
                        size="sm"
                        className="ml-auto"
                    >
                        Send
                    </Button>
                </div>
            </div>
        </form>
    );
};
