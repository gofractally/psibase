import { useEffect } from "react";

import {
    ComposeDialog,
    Mailbox,
    MailboxHeader,
} from "@/apps/chainmail/components";
import { useMediaQuery } from "@/hooks/useMediaQuery";

import { useIncomingMessages } from "@/apps/chainmail/hooks";

export default function InboxPage() {
    const isDesktop = useMediaQuery("(min-width: 1440px)");
    const { query, selectedMessage, setSelectedMessageId } =
        useIncomingMessages();

    useEffect(() => {
        setSelectedMessageId("");
    }, []);

    return (
        <div className="flex h-screen flex-col">
            <MailboxHeader>Inbox</MailboxHeader>
            <Mailbox
                isDesktop={isDesktop}
                mailbox="inbox"
                messages={query.data ?? []}
                selectedMessage={selectedMessage}
                setSelectedMessageId={setSelectedMessageId}
            />
        </div>
    );
}
