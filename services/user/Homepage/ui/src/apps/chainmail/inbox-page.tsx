import { useState } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { InboxList } from "@/apps/chainmail/components/inbox-list";
import { MessageDetail } from "@/apps/chainmail/components/message-detail";
import { messages } from "@/apps/chainmail/data";

export default function InboxPage() {
    const [selectedMessageId, setSelectedMessageId] = useState<string | null>(
        null,
    );
    const isMobile = useIsMobile();

    const selectedMessage = selectedMessageId
        ? messages.find((message) => message.id === selectedMessageId)
        : null;

    return (
        <div className="flex h-screen flex-col">
            <header className="border-b p-4">
                <h1 className="text-xl font-bold">Inbox</h1>
            </header>

            <main className="flex flex-1 overflow-hidden">
                {/* On mobile, show either the inbox list or the message detail */}
                {isMobile && selectedMessageId ? (
                    <MessageDetail
                        message={selectedMessage ?? null}
                        onBack={() => setSelectedMessageId(null)}
                    />
                ) : (
                    <div
                        className={`flex flex-1 ${isMobile ? "w-full" : "max-w-md border-r"}`}
                    >
                        <InboxList
                            messages={messages}
                            selectedId={selectedMessageId}
                            onSelectMessage={setSelectedMessageId}
                        />
                    </div>
                )}

                {/* On desktop, always show the message detail alongside the inbox */}
                {!isMobile && (
                    <div className="flex-1 overflow-hidden">
                        {selectedMessage ? (
                            <MessageDetail message={selectedMessage} />
                        ) : (
                            <div className="flex h-full items-center justify-center text-muted-foreground">
                                Select a message to view
                            </div>
                        )}
                    </div>
                )}
            </main>
        </div>
    );
}
