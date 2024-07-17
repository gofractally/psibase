import { ComponentProps } from "react";
import { formatDistanceToNow } from "date-fns";

import { cn } from "@lib/utils";
import { Badge } from "@shadcn/badge";
import { ScrollArea } from "@shadcn/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@shadcn/tooltip";
import { type Message, useLocalMail, useUser } from "@hooks";

import { accounts } from "../fixtures/data";

export function MailList({ filter }: { filter: "inbox" | "drafts" | "sent" }) {
    const [mail] = useLocalMail();
    const [user] = useUser();

    let messages = mail?.filter((m) => {
        switch (filter) {
            case "inbox":
                return m.to === user.account && m.status === "sent";
            case "drafts":
                return m.from === user.account && m.status === "draft";
            case "sent":
                return m.from === user.account && m.status === "sent";
            default:
                return true;
        }
    });

    return (
        <ScrollArea className="h-screen">
            <div className="flex flex-1 flex-col gap-2 p-4 pt-0">
                {messages
                    ?.sort((a, b) => b.datetime - a.datetime)
                    .map((item) => <MailItem item={item} />)}
            </div>
        </ScrollArea>
    );
}

const MailItem = ({ item }: { item: Message }) => {
    const [_, selectedMessage, setSelectedMessageId] = useLocalMail();
    const account = accounts.find((a) => a.account === item.from);
    return (
        <button
            key={item.id}
            className={cn(
                "flex flex-col items-start gap-2 rounded-lg border p-3 text-left text-sm transition-all hover:bg-accent",
                selectedMessage?.id === item.id && "bg-muted",
            )}
            onClick={() => {
                console.info(item);
                setSelectedMessageId(item.id);
            }}
        >
            <div className="flex w-full flex-col gap-1">
                <div className="flex items-center">
                    <div className="flex items-center gap-2">
                        {account ? (
                            <Tooltip>
                                <TooltipTrigger>
                                    <div className="font-semibold">
                                        {account?.name}
                                    </div>
                                </TooltipTrigger>
                                <TooltipContent side="right">
                                    {item.from}
                                </TooltipContent>
                            </Tooltip>
                        ) : null}
                        {/* {!item.read && (
                                        <span className="flex h-2 w-2 rounded-full bg-blue-600" />
                                    )} */}
                    </div>
                    <div
                        className={cn(
                            "ml-auto text-xs",
                            selectedMessage?.id === item.id
                                ? "text-foreground"
                                : "text-muted-foreground",
                        )}
                    >
                        {formatDistanceToNow(new Date(item.datetime), {
                            addSuffix: true,
                        })}
                    </div>
                </div>
                <div className="text-xs font-medium">{item.subject}</div>
            </div>
            <div className="line-clamp-2 text-xs text-muted-foreground">
                {item.body.substring(0, 300)}
            </div>
            {/* {item.labels.length ? (
                            <div className="flex items-center gap-2">
                                {item.labels.map((label) => (
                                    <Badge
                                        key={label}
                                        variant={getBadgeVariantFromLabel(
                                            label,
                                        )}
                                    >
                                        {label}
                                    </Badge>
                                ))}
                            </div>
                        ) : null} */}
        </button>
    );
};

function getBadgeVariantFromLabel(
    label: string,
): ComponentProps<typeof Badge>["variant"] {
    if (["work"].includes(label.toLowerCase())) {
        return "default";
    }

    if (["personal"].includes(label.toLowerCase())) {
        return "outline";
    }

    return "secondary";
}
