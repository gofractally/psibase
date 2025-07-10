import {
    MailList,
    MailboxHeader,
    MessageDetail,
} from "@/apps/chainmail/components";
import { useIsDesktop, useSavedMessages } from "@/apps/chainmail/hooks";
import { useEffect } from "react";

import { TwoColumnSelect } from "@/components/two-column-select";

export default function SavedPage() {
    const isDesktop = useIsDesktop();
    const { query, selectedMessage, setSelectedMessageId } = useSavedMessages();

    useEffect(() => {
        setSelectedMessageId("");
    }, []);

    const display = isDesktop ? "both" : selectedMessage ? "right" : "left";

    return (
        <TwoColumnSelect
            left={
                <MailList
                    mailbox={"saved"}
                    messages={query.data ?? []}
                    onSelectMessage={setSelectedMessageId}
                    selectedMessage={selectedMessage}
                />
            }
            right={
                <MessageDetail
                    message={selectedMessage ?? null}
                    mailbox={"saved"}
                    onBack={() => setSelectedMessageId("")}
                />
            }
            header={<MailboxHeader>Saved</MailboxHeader>}
            displayMode={display}
        />
    );
}
