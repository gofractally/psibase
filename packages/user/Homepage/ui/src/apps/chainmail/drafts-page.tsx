import { useEffect } from "react";

import { NoMessageSelected } from "@/apps/chainmail/components/empty-states";
import { MailList } from "@/apps/chainmail/components/mail-list";
import { MailboxHeader } from "@/apps/chainmail/components/mailbox-header";
import { MessageDetail } from "@/apps/chainmail/components/message-detail";
import { useIsDesktop } from "@/apps/chainmail/hooks/use-is-desktop";
import { useDraftMessages } from "@/apps/chainmail/hooks/use-mail";

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
