import type { Mailbox as MailboxType, Message } from "../types";

import {
    ResizableHandle,
    ResizablePanel,
    ResizablePanelGroup,
} from "@/components/ui/resizable";

import { NotLoggedIn } from "@/components";

import { useCurrentUser } from "@/hooks/useCurrentUser";

import {
    EmptyBox,
    LoadingBox,
    MailList as MailListComponent,
    type MailListProps,
    MessageDetail,
    NoMessageSelected,
} from "@/apps/chainmail/components";

interface MailboxProps {
    isDesktop: boolean;
    mailbox: MailboxType;
    messages: Message[];
    isLoading: boolean;
    selectedMessage?: Message;
    setSelectedMessageId: (id: string) => void;
}

export function Mailbox({
    isDesktop,
    mailbox,
    messages,
    isLoading,
    selectedMessage,
    setSelectedMessageId,
}: MailboxProps) {
    const { data: currentUser, isPending: isPendingCurrentUser } =
        useCurrentUser();

    if (!currentUser && !isPendingCurrentUser) {
        return (
            <main className="flex-1">
                <div className="mx-auto max-w-lg px-4 pt-8">
                    <NotLoggedIn />
                </div>
            </main>
        );
    }

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
                            isLoading={isLoading}
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
                    isLoading={isLoading}
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
    isLoading,
}: MailListProps & { isLoading: boolean }) => {
    if (isLoading) {
        return <LoadingBox />;
    }

    if (!messages.length) {
        return <EmptyBox>No messages</EmptyBox>;
    }

    return (
        <MailListComponent
            mailbox={mailbox}
            messages={messages}
            onSelectMessage={onSelectMessage}
            selectedMessage={selectedMessage}
        />
    );
};
