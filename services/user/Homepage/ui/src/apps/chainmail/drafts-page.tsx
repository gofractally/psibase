import { useEffect } from "react";
import { useMediaQuery } from "usehooks-ts";

import { Mailbox, MailboxHeader } from "@/apps/chainmail/components";
import { useDraftMessages } from "@/apps/chainmail/hooks";

export default function DraftsPage() {
    const isDesktop = useMediaQuery("(min-width: 1440px)");
    const { drafts, selectedMessage, setSelectedMessageId } =
        useDraftMessages();

    useEffect(() => {
        setSelectedMessageId("");
    }, []);

    return (
        <div className="flex h-[calc(100dvh-theme(spacing.20))] flex-col">
            <MailboxHeader>Drafts</MailboxHeader>
            <Mailbox
                isDesktop={isDesktop}
                mailbox="drafts"
                messages={drafts ?? []}
                isLoading={false}
                selectedMessage={selectedMessage}
                setSelectedMessageId={setSelectedMessageId}
            />
        </div>
    );
}
