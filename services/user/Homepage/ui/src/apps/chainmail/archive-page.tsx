import { useEffect } from "react";

import { TwoColumnSelect } from "@/components/TwoColumnSelect";

import {
    MailList,
    MailboxHeader,
    MessageDetail,
} from "@/apps/chainmail/components";
import { useArchivedMessages, useIsDesktop } from "@/apps/chainmail/hooks";

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
