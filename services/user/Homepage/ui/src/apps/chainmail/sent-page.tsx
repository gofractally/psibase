import { useEffect } from "react";

import { TwoColumnSelect } from "@/components/two-column-select";

import {
    MailList,
    MailboxHeader,
    MessageDetail,
    NoMessageSelected,
} from "@/apps/chainmail/components";
import { useIsDesktop, useSentMessages } from "@/apps/chainmail/hooks";

export default function SentPage() {
    const isDesktop = useIsDesktop();
    const { query, selectedMessage, setSelectedMessageId } = useSentMessages();

    useEffect(() => {
        setSelectedMessageId("");
    }, []);

    const display = isDesktop ? "both" : selectedMessage ? "right" : "left";

    return (
        <TwoColumnSelect
            left={
                <MailList
                    mailbox={"sent"}
                    messages={query.data ?? []}
                    onSelectMessage={setSelectedMessageId}
                    selectedMessage={selectedMessage}
                />
            }
            right={
                selectedMessage ? (
                    <MessageDetail
                        message={selectedMessage ?? null}
                        mailbox={"sent"}
                        onBack={() => setSelectedMessageId("")}
                    />
                ) : (
                    <NoMessageSelected>Select a message</NoMessageSelected>
                )
            }
            header={<MailboxHeader>Sent</MailboxHeader>}
            displayMode={display}
        />
    );
}
