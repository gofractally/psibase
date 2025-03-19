import { useEffect } from "react";

import { Mailbox, MailboxHeader } from "@/apps/chainmail/components";
import { useDraftMessages, useIsDesktop } from "@/apps/chainmail/hooks";

export default function DraftsPage() {
    const isDesktop = useIsDesktop();
    const { userDrafts, selectedMessage, setSelectedMessageId } =
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
                messages={userDrafts ?? []}
                isLoading={false}
                selectedMessage={selectedMessage}
                setSelectedMessageId={setSelectedMessageId}
            />
        </div>
    );
}
