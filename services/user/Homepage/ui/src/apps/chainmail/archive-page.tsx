import { useEffect } from "react";

import { Mailbox, MailboxHeader } from "@/apps/chainmail/components";
import { useArchivedMessages, useIsDesktop } from "@/apps/chainmail/hooks";

export default function ArchivePage() {
    const isDesktop = useIsDesktop();
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
