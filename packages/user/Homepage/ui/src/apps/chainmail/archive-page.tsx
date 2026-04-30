import { useEffect } from "react";

import { MailList } from "@/apps/chainmail/components/mail-list";
import { MailboxHeader } from "@/apps/chainmail/components/mailbox-header";
import { MessageDetail } from "@/apps/chainmail/components/message-detail";
import { useIsDesktop } from "@/apps/chainmail/hooks/use-is-desktop";
import { useArchivedMessages } from "@/apps/chainmail/hooks/use-mail";

import { TwoColumnSelect } from "@/components/two-column-select";

export default function ArchivePage() {
    const isDesktop = useIsDesktop();
    const { query, selectedMessage, setSelectedMessageId } =
        useArchivedMessages();

    useEffect(() => {
        setSelectedMessageId("");
    }, []);

    const display = isDesktop ? "both" : selectedMessage ? "right" : "left";

    return (
        <TwoColumnSelect
            left={
                <MailList
                    isLoading={query.isLoading}
                    mailbox={"archived"}
                    messages={query.data ?? []}
                    onSelectMessage={setSelectedMessageId}
                    selectedMessage={selectedMessage}
                />
            }
            right={
                <MessageDetail
                    message={selectedMessage ?? null}
                    mailbox={"archived"}
                    onBack={() => setSelectedMessageId("")}
                />
            }
            header={<MailboxHeader>Archived</MailboxHeader>}
            displayMode={display}
        />
    );
}
