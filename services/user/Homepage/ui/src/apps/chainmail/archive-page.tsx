import { useEffect } from "react";
import { useMediaQuery } from "usehooks-ts";

import { Mailbox, MailboxHeader } from "@/apps/chainmail/components";
import { useArchivedMessages } from "@/apps/chainmail/hooks";

export default function ArchivePage() {
    const isDesktop = useMediaQuery("(min-width: 1440px)");
    const { query, selectedMessage, setSelectedMessageId } =
        useArchivedMessages();

    useEffect(() => {
        setSelectedMessageId("");
    }, []);

    return (
        <div className="flex h-[calc(100dvh-theme(spacing.20))] flex-col">
            <MailboxHeader>Archived Messages</MailboxHeader>
            <Mailbox
                isDesktop={isDesktop}
                mailbox="archived"
                messages={query.data ?? []}
                isLoading={query.isLoading}
                selectedMessage={selectedMessage}
                setSelectedMessageId={setSelectedMessageId}
            />
        </div>
    );
}
