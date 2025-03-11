import { useEffect } from "react";

import { Mailbox } from "@/apps/chainmail/components";
import { useMediaQuery } from "@/hooks/useMediaQuery";

import { useArchivedMessages } from "@/apps/chainmail/hooks";

export default function ArchivePage() {
    const isDesktop = useMediaQuery("(min-width: 1440px)");
    const { query, selectedMessage, setSelectedMessageId } =
        useArchivedMessages();

    useEffect(() => {
        setSelectedMessageId("");
    }, []);

    return (
        <div className="flex h-screen flex-col">
            <header className="border-b p-4">
                <h1 className="text-xl font-bold">Archived Messages</h1>
            </header>

            <Mailbox
                isDesktop={isDesktop}
                mailbox="archived"
                messages={query.data ?? []}
                selectedMessage={selectedMessage}
                setSelectedMessageId={setSelectedMessageId}
            />
        </div>
    );
}
