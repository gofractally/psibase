import { useEffect } from "react";

import { MailList } from "@/apps/chainmail/components/mail-list";
import { MailboxHeader } from "@/apps/chainmail/components/mailbox-header";
import { MessageDetail } from "@/apps/chainmail/components/message-detail";
import { useIsDesktop } from "@/apps/chainmail/hooks/use-is-desktop";
import { useSavedMessages } from "@/apps/chainmail/hooks/use-mail";

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
