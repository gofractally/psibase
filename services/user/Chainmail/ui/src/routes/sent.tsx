import {
    ResizableHandle,
    ResizablePanel,
    ResizablePanelGroup,
} from "@shadcn/resizable";
import { Separator } from "@shadcn/separator";

import { MailDisplay } from "@components/mail-display";
import { MailList } from "@components/mail-list";

import { useSentMessages } from "@hooks";
import { useEffect } from "react";
import { EmptyBox, ModeToggle } from "@components";

export function Sent() {
    const { query, selectedMessage, setSelectedMessageId } = useSentMessages();

    useEffect(() => {
        setSelectedMessageId("");
    }, []);

    return (
        <ResizablePanelGroup
            direction="horizontal"
            className="items-stretch"
            autoSaveId="post-list-panels"
        >
            <ResizablePanel minSize={30} id="list" order={3}>
                <div className="flex h-[56px] items-center justify-between px-4">
                    <h1 className="text-xl font-bold">Sent</h1>
                    <ModeToggle />
                </div>
                <Separator />
                <div className="h-full py-4">
                    {query.data?.length ? (
                        <MailList
                            mailbox="sent"
                            messages={query.data ?? []}
                            selectedMessage={selectedMessage}
                            setSelectedMessageId={setSelectedMessageId}
                        />
                    ) : (
                        <EmptyBox>No sent messages</EmptyBox>
                    )}
                </div>
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel id="message" order={4}>
                <MailDisplay message={selectedMessage} mailbox="sent" />
            </ResizablePanel>
        </ResizablePanelGroup>
    );
}

export default Sent;