import {
    MailList,
    MailboxHeader,
    MessageDetail,
} from "@/apps/chainmail/components";
import { useArchivedMessages, useIsDesktop } from "@/apps/chainmail/hooks";
import { useEffect } from "react";

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
