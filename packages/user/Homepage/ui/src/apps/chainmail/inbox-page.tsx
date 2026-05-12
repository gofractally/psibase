import { useEffect } from "react";

import { NoMessageSelected } from "@/apps/chainmail/components/empty-states";
import { MailList } from "@/apps/chainmail/components/mail-list";
import { MailboxHeader } from "@/apps/chainmail/components/mailbox-header";
import { MessageDetail } from "@/apps/chainmail/components/message-detail";
import { useIsDesktop } from "@/apps/chainmail/hooks/use-is-desktop";
import { useIncomingMessages } from "@/apps/chainmail/hooks/use-mail";

import { TwoColumnSelect } from "@/components/two-column-select";

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
