import { useEffect } from "react";

import { useMediaQuery } from "@/hooks/useMediaQuery";

import { Mailbox, MailboxHeader } from "@/apps/chainmail/components";
import { useSentMessages } from "@/apps/chainmail/hooks";

export default function SentPage() {
    const isDesktop = useMediaQuery("(min-width: 1440px)");
    const { query, selectedMessage, setSelectedMessageId } = useSentMessages();

    useEffect(() => {
        setSelectedMessageId("");
    }, []);

    return (
        <div className="flex h-[calc(100dvh-theme(spacing.20))] flex-col">
            <MailboxHeader>Sent Messages</MailboxHeader>
            <Mailbox
                isDesktop={isDesktop}
                mailbox="sent"
                messages={query.data ?? []}
                isLoading={query.isLoading}
                selectedMessage={selectedMessage}
                setSelectedMessageId={setSelectedMessageId}
            />
        </div>
    );
}
