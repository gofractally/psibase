import { useEffect } from "react";

import { Mailbox } from "@/apps/chainmail/components";
import { useMediaQuery } from "@/hooks/useMediaQuery";

import { useDraftMessages } from "@/apps/chainmail/hooks";

export default function DraftsPage() {
    const isDesktop = useMediaQuery("(min-width: 1440px)");
    const { drafts, selectedMessage, setSelectedMessageId } =
        useDraftMessages();

    useEffect(() => {
        setSelectedMessageId("");
    }, []);

    return (
        <div className="flex h-screen flex-col">
            <header className="border-b p-4">
                <h1 className="text-xl font-bold">Drafts</h1>
            </header>

            <Mailbox
                isDesktop={isDesktop}
                mailbox="drafts"
                messages={drafts ?? []}
                selectedMessage={selectedMessage}
                setSelectedMessageId={setSelectedMessageId}
            />
        </div>
    );
}
