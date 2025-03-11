import { useEffect } from "react";

import { Mailbox } from "@/apps/chainmail/components";
import { useMediaQuery } from "@/hooks/useMediaQuery";

import { useSavedMessages } from "@/apps/chainmail/hooks";

export default function SavedPage() {
    const isDesktop = useMediaQuery("(min-width: 1440px)");
    const { query, selectedMessage, setSelectedMessageId } = useSavedMessages();

    useEffect(() => {
        setSelectedMessageId("");
    }, []);

    return (
        <div className="flex h-screen flex-col">
            <header className="border-b p-4">
                <h1 className="text-xl font-bold">Saved Messages</h1>
            </header>

            <Mailbox
                isDesktop={isDesktop}
                mailbox="saved"
                messages={query.data ?? []}
                selectedMessage={selectedMessage}
                setSelectedMessageId={setSelectedMessageId}
            />
        </div>
    );
}
