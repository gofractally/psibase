import { useEffect } from "react";

import { Mailbox, MailboxHeader } from "@/apps/chainmail/components";
import { useIncomingMessages, useIsDesktop } from "@/apps/chainmail/hooks";

export default function InboxPage() {
    const isDesktop = useIsDesktop();
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
                isLoading={query.isPending}
                selectedMessage={selectedMessage}
                setSelectedMessageId={setSelectedMessageId}
            />
        </div>
    );
}
