import { useEffect } from "react";
import { useMediaQuery } from "usehooks-ts";

import { Mailbox, MailboxHeader } from "@/apps/chainmail/components";
import { useSavedMessages } from "@/apps/chainmail/hooks";

export default function SavedPage() {
    const isDesktop = useMediaQuery("(min-width: 1440px)");
    const { query, selectedMessage, setSelectedMessageId } = useSavedMessages();

    useEffect(() => {
        setSelectedMessageId("");
    }, []);

    return (
        <div className="flex h-[calc(100dvh-theme(spacing.20))] flex-col">
            <MailboxHeader>Saved Messages</MailboxHeader>
            <Mailbox
                isDesktop={isDesktop}
                mailbox="saved"
                messages={query.data ?? []}
                isLoading={query.isLoading}
                selectedMessage={selectedMessage}
                setSelectedMessageId={setSelectedMessageId}
            />
        </div>
    );
}
