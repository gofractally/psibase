import { useEffect } from "react";

import { Mailbox, MailboxHeader } from "@/apps/chainmail/components";
import { useMediaQuery } from "@/hooks/useMediaQuery";

import { useSavedMessages } from "@/apps/chainmail/hooks";

export default function SavedPage() {
    const isDesktop = useMediaQuery("(min-width: 1440px)");
    const { query, selectedMessage, setSelectedMessageId } = useSavedMessages();

    useEffect(() => {
        setSelectedMessageId("");
    }, []);

    return (
        <div className="flex h-screen flex-col">
            <MailboxHeader>Saved Messages</MailboxHeader>
            <Mailbox
                isDesktop={isDesktop}
                mailbox="saved"
                messages={query.data ?? []}
                selectedMessage={selectedMessage}
                setSelectedMessageId={setSelectedMessageId}
            />
        </div>
    );
}
