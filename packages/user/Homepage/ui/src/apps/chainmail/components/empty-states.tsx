import type { Mailbox } from "@/apps/chainmail/types";

import { Inbox, Mail, PencilLine, Send } from "lucide-react";

import {
    Empty,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle,
} from "@shared/shadcn/ui/empty";

const emptyMailboxCopy: Record<
    Mailbox,
    { title: string; description: string; icon: typeof Inbox }
> = {
    inbox: {
        title: "No messages",
        description: "When someone writes you, it will show up here.",
        icon: Inbox,
    },
    sent: {
        title: "No sent messages",
        description: "Messages you send will appear here.",
        icon: Send,
    },
    drafts: {
        title: "No drafts",
        description: "Unsent messages are saved here automatically.",
        icon: PencilLine,
    },
};

export const EmptyBox = ({ mailbox }: { mailbox: Mailbox }) => {
    const { title, description, icon: Icon } = emptyMailboxCopy[mailbox];

    return (
        <Empty className="h-full border-none">
            <EmptyHeader>
                <EmptyMedia variant="icon">
                    <Icon />
                </EmptyMedia>
                <EmptyTitle>{title}</EmptyTitle>
                <EmptyDescription>{description}</EmptyDescription>
            </EmptyHeader>
        </Empty>
    );
};

export const NoMessageSelected = () => {
    return (
        <Empty className="h-full border-none">
            <EmptyHeader>
                <EmptyMedia variant="icon">
                    <Mail />
                </EmptyMedia>
                <EmptyTitle>Select a message</EmptyTitle>
                <EmptyDescription>
                    Choose a message from the list to read it here.
                </EmptyDescription>
            </EmptyHeader>
        </Empty>
    );
};
