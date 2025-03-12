import type { Mailbox as MailboxType } from "../types";
import type { Message } from "@/apps/chainmail/hooks";

import {
    ResizableHandle,
    ResizablePanel,
    ResizablePanelGroup,
} from "@/components/ui/resizable";

import {
    EmptyBox,
    MessageDetail,
    NoMessageSelected,
    MailList as MailListComponent,
    type MailListProps,
} from "@/apps/chainmail/components";

interface MailboxProps {
    isDesktop: boolean;
    mailbox: MailboxType;
    messages: Message[];
    selectedMessage?: Message;
    setSelectedMessageId: (id: string) => void;
}

export function Mailbox({
    isDesktop,
    mailbox,
    messages,
    selectedMessage,
    setSelectedMessageId,
}: MailboxProps) {
    return (
        <main className="flex-1 overflow-hidden">
            {!isDesktop && selectedMessage ? (
                <MessageDetail
                    message={selectedMessage ?? null}
                    mailbox={mailbox}
                    onBack={() => setSelectedMessageId("")}
                />
            ) : isDesktop ? (
                <ResizablePanelGroup direction="horizontal">
                    <ResizablePanel
                        defaultSize={40}
                        minSize={20}
                        maxSize={40}
                        className="border-r"
                    >
                        <MailList
                            mailbox={mailbox}
                            messages={messages}
                            onSelectMessage={setSelectedMessageId}
                            selectedMessage={selectedMessage}
                        />
                    </ResizablePanel>
                    <ResizableHandle withHandle />
                    <ResizablePanel defaultSize={75}>
                        {selectedMessage ? (
                            <MessageDetail
                                message={selectedMessage}
                                mailbox={mailbox}
                                onBack={() => setSelectedMessageId("")}
                            />
                        ) : (
                            <NoMessageSelected>
                                Select a message
                            </NoMessageSelected>
                        )}
                    </ResizablePanel>
                </ResizablePanelGroup>
            ) : (
                <MailList
                    mailbox={mailbox}
                    messages={messages}
                    onSelectMessage={setSelectedMessageId}
                    selectedMessage={selectedMessage}
                />
            )}
        </main>
    );
}

export default Mailbox;

const MailList = ({
    mailbox,
    messages,
    onSelectMessage,
    selectedMessage,
}: MailListProps) => {
    if (messages.length) {
        return (
            <MailListComponent
                mailbox={mailbox}
                messages={messages}
                onSelectMessage={onSelectMessage}
                selectedMessage={selectedMessage}
            />
        );
    }
    return <EmptyBox>No messages</EmptyBox>;
};
