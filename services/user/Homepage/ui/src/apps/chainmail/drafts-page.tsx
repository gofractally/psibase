import {
    MailList,
    MailboxHeader,
    MessageDetail,
    NoMessageSelected,
} from "@/apps/chainmail/components";
import { useDraftMessages, useIsDesktop } from "@/apps/chainmail/hooks";
import { useEffect } from "react";

import { TwoColumnSelect } from "@/components/two-column-select";

export default function DraftsPage() {
    const isDesktop = useIsDesktop();

    const { userDrafts, selectedMessage, setSelectedMessageId } =
        useDraftMessages();

    useEffect(() => {
        setSelectedMessageId("");
    }, []);

    const display = isDesktop ? "both" : selectedMessage ? "right" : "left";

    return (
        <TwoColumnSelect
            left={
                <MailList
                    mailbox={"drafts"}
                    messages={userDrafts ?? []}
                    onSelectMessage={setSelectedMessageId}
                    selectedMessage={selectedMessage}
                />
            }
            right={
                selectedMessage ? (
                    <MessageDetail
                        message={selectedMessage ?? null}
                        mailbox={"drafts"}
                        onBack={() => setSelectedMessageId("")}
                    />
                ) : (
                    <NoMessageSelected>Select a message</NoMessageSelected>
                )
            }
            header={<MailboxHeader>Drafts</MailboxHeader>}
            displayMode={display}
        />
    );
}
