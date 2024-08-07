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
                </div>
                <Separator />
                {/* <div className="bg-background/95 p-4 backdrop-blur supports-[backdrop-filter]:bg-background/60">
                    <form>
                        <div className="relative">
                            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input placeholder="Search" className="pl-8" />
                        </div>
                    </form>
                </div> */}
                <div className="py-4">
                    <MailList
                        mailbox="sent"
                        messages={query.data ?? []}
                        selectedMessage={selectedMessage}
                        setSelectedMessageId={setSelectedMessageId}
                    />
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
