import { useEffect } from "react";

import { Mailbox, MailboxHeader } from "@/apps/chainmail/components";
import { useIsDesktop, useSentMessages } from "@/apps/chainmail/hooks";

export default function SentPage() {
    const isDesktop = useIsDesktop();
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
                isLoading={query.isPending}
                selectedMessage={selectedMessage}
                setSelectedMessageId={setSelectedMessageId}
            />
        </div>
    );
}
