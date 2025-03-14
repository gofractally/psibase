import { useEffect } from "react";

import { useMediaQuery } from "@/hooks/useMediaQuery";

import { Mailbox, MailboxHeader } from "@/apps/chainmail/components";
import { useIncomingMessages } from "@/apps/chainmail/hooks";

export default function InboxPage() {
    const isDesktop = useMediaQuery("(min-width: 1440px)");
    const { query, selectedMessage, setSelectedMessageId } =
        useIncomingMessages();

    useEffect(() => {
        setSelectedMessageId("");
    }, []);

    return (
        <div className="flex h-[calc(100dvh-theme(spacing.20))] flex-col">
            <MailboxHeader>Inbox</MailboxHeader>
            <Mailbox
                isDesktop={isDesktop}
                mailbox="inbox"
                messages={query.data ?? []}
                isLoading={query.isLoading}
                selectedMessage={selectedMessage}
                setSelectedMessageId={setSelectedMessageId}
            />
        </div>
    );
}
