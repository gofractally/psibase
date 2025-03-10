import { useState } from "react";
import {
    ResizableHandle,
    ResizablePanel,
    ResizablePanelGroup,
} from "@/components/ui/resizable";
import { useIsMobile } from "@/hooks/use-mobile";
import { InboxList } from "@/apps/chainmail/components/inbox-list";
import { MessageDetail } from "@/apps/chainmail/components/message-detail";
import { messages } from "@/apps/chainmail/data";

export default function InboxPage() {
    const [selectedMessageId, setSelectedMessageId] = useState<string | null>(
        null,
    );
    const isDesktop = !useIsMobile();

    const selectedMessage = selectedMessageId
        ? messages.find((message) => message.id === selectedMessageId)
        : null;

    return (
        <div className="flex h-screen flex-col">
            <header className="border-b p-4">
                <h1 className="text-xl font-bold">Inbox</h1>
            </header>

            <main className="flex-1 overflow-hidden">
                {/* On mobile, show either the inbox list or the message detail */}
                {!isDesktop && selectedMessageId ? (
                    <MessageDetail
                        message={selectedMessage ?? null}
                        onBack={() => setSelectedMessageId(null)}
                    />
                ) : isDesktop ? (
                    <ResizablePanelGroup direction="horizontal">
                        <ResizablePanel
                            defaultSize={25}
                            minSize={15}
                            maxSize={40}
                            className="border-r"
                        >
                            <InboxList
                                messages={messages}
                                selectedId={selectedMessageId}
                                onSelectMessage={setSelectedMessageId}
                            />
                        </ResizablePanel>
                        <ResizableHandle withHandle />
                        <ResizablePanel defaultSize={75}>
                            {selectedMessage ? (
                                <MessageDetail message={selectedMessage} />
                            ) : (
                                <div className="flex h-full items-center justify-center text-muted-foreground">
                                    Select a message to view
                                </div>
                            )}
                        </ResizablePanel>
                    </ResizablePanelGroup>
                ) : (
                    <InboxList
                        messages={messages}
                        selectedId={selectedMessageId}
                        onSelectMessage={setSelectedMessageId}
                    />
                )}
            </main>
        </div>
    );
}
