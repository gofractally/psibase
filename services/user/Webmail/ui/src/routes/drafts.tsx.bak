import {
    ResizableHandle,
    ResizablePanel,
    ResizablePanelGroup,
} from "@shadcn/resizable";
import { Separator } from "@shadcn/separator";

import { MailDisplay } from "@components/mail-display";
import { MailList } from "@components/mail-list";

import { Dialog } from "@shadcn/dialog";
import {
    ComposeDialog,
    ComposeDialogTriggerIconWithTooltip,
} from "@components";
import { useLocalMail } from "@hooks";
import { useEffect } from "react";

export function Drafts() {
    const [_, _a, setSelectedMessageId] = useLocalMail();

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
                    <h1 className="text-xl font-bold">Drafts</h1>
                    <div className="flex items-center gap-2">
                        <Dialog>
                            <ComposeDialog
                                trigger={
                                    <ComposeDialogTriggerIconWithTooltip />
                                }
                            />
                        </Dialog>
                    </div>
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
                    <MailList filter="drafts" />
                </div>
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel id="message" order={4}>
                <MailDisplay />
            </ResizablePanel>
        </ResizablePanelGroup>
    );
}

export default Drafts;
