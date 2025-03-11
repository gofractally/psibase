import { useEffect } from "react";
import {
    ResizableHandle,
    ResizablePanel,
    ResizablePanelGroup,
} from "@/components/ui/resizable";

import {
    EmptyBox,
    MessageDetail,
    NoMessageSelected,
    MailList,
} from "@/apps/chainmail/components";
import { useMediaQuery } from "@/hooks/useMediaQuery";

import { useIncomingMessages } from "@/apps/chainmail/hooks";

export default function InboxPage() {
    const isDesktop = useMediaQuery("(min-width: 1440px)");
    const { query, selectedMessage, setSelectedMessageId } =
        useIncomingMessages();

    useEffect(() => {
        setSelectedMessageId("");
    }, []);
    const messages = query.data ?? [];

    return (
        <div className="flex h-screen flex-col">
            <header className="border-b p-4">
                <h1 className="text-xl font-bold">Inbox</h1>
            </header>

            <main className="flex-1 overflow-hidden">
                {/* On mobile, show either the inbox list or the message detail */}
                {!isDesktop && selectedMessage ? (
                    <MessageDetail
                        message={selectedMessage ?? null}
                        mailbox="inbox"
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
                            {messages.length ? (
                                <MailList
                                    mailbox="inbox"
                                    messages={messages}
                                    onSelectMessage={setSelectedMessageId}
                                    selectedMessage={selectedMessage}
                                />
                            ) : (
                                <EmptyBox>No messages</EmptyBox>
                            )}
                        </ResizablePanel>
                        <ResizableHandle withHandle />
                        <ResizablePanel defaultSize={75}>
                            {selectedMessage ? (
                                <MessageDetail
                                    message={selectedMessage}
                                    mailbox="inbox"
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
                        mailbox="inbox"
                        messages={messages}
                        onSelectMessage={setSelectedMessageId}
                        selectedMessage={selectedMessage}
                    />
                )}
            </main>
        </div>
    );
}
