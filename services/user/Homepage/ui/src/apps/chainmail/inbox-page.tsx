import { useEffect } from "react";

import { TwoColumnSelect } from "@/components/two-column-select";

import {
    MailList,
    MailboxHeader,
    MessageDetail,
    NoMessageSelected,
} from "@/apps/chainmail/components";
import { useIncomingMessages, useIsDesktop } from "@/apps/chainmail/hooks";

export default function InboxPage() {
    const isDesktop = useIsDesktop();

    const { query, selectedMessage, setSelectedMessageId } =
        useIncomingMessages();

    useEffect(() => {
        setSelectedMessageId("");
    }, []);

    const display = isDesktop ? "both" : selectedMessage ? "right" : "left";

    return (
        <TwoColumnSelect
            left={
                <MailList
                    mailbox="inbox"
                    messages={query.data ?? []}
                    onSelectMessage={setSelectedMessageId}
                    selectedMessage={selectedMessage}
                    isLoading={query.isLoading}
                />
            }
            right={
                selectedMessage ? (
                    <MessageDetail
                        message={selectedMessage ?? null}
                        mailbox={"inbox"}
                        onBack={
                            display === "right"
                                ? () => setSelectedMessageId("")
                                : undefined
                        }
                    />
                ) : (
                    <NoMessageSelected>Select a message</NoMessageSelected>
                )
            }
            header={<MailboxHeader>Inbox</MailboxHeader>}
            displayMode={display}
        />
    );
}
