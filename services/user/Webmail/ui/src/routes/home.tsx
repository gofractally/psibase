import { useEffect } from "react";

import {
    ResizableHandle,
    ResizablePanel,
    ResizablePanelGroup,
} from "@shadcn/resizable";
import { Separator } from "@shadcn/separator";

import { MailDisplay } from "@components/mail-display";
import { MailList } from "@components/mail-list";

import { useIncomingMessages } from "@hooks/use-mail";
import { Dialog } from "@shadcn/dialog";
import {
    ComposeDialog,
    ComposeDialogTriggerIconWithTooltip,
    EmptyBox,
    ModeToggle,
} from "@components";

export function Home() {
    const { query, selectedMessage, setSelectedMessageId } =
        useIncomingMessages();

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
                <div className="flex items-center justify-between px-4">
                    <h1 className="text-xl font-bold">Inbox</h1>
                    <div className="flex items-center gap-2">
                        <Dialog>
                            <ComposeDialog
                                trigger={
                                    <ComposeDialogTriggerIconWithTooltip />
                                }
                            />
                        </Dialog>
                        <ModeToggle />
                    </div>
                </div>
                <Separator />
                <div className="h-full py-4">
                    {query.data?.length ? (
                        <MailList
                            mailbox="inbox"
                            messages={query.data ?? []}
                            selectedMessage={selectedMessage}
                            setSelectedMessageId={setSelectedMessageId}
                        />
                    ) : (
                        <EmptyBox>No messages</EmptyBox>
                    )}
                </div>
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel id="message" order={4}>
                <MailDisplay message={selectedMessage} mailbox="inbox" />
            </ResizablePanel>
        </ResizablePanelGroup>
    );
}

export default Home;
