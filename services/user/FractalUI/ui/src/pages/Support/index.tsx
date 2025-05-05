import dayjs from "dayjs";
import relative from "dayjs/plugin/relativeTime";
import { useNavigate } from "react-router-dom";

import { ScrollArea } from "@/components/ui/scroll-area";

import { EmptyBlock } from "@/components/EmptyBlock";
import { LoadingBlock } from "@/components/LoadingBlock";

import { useChainId } from "@/hooks/use-chain-id";
import { useCurrentFractal } from "@/hooks/useCurrentFractal";
import { useMessages } from "@/hooks/useMessages";
import { createIdenticon } from "@/lib/createIdenticon";
import {
    getThreadIdentifier,
    removeReplyPrefix,
} from "@/lib/createThreadIdentifier";

dayjs.extend(relative);

export const Support = () => {
    const currentFractal = useCurrentFractal();
    const { data: dataMessages, isLoading } = useMessages(currentFractal);
    const messages = dataMessages ? dataMessages : [];

    const { data: chainId } = useChainId();

    const sortedMessages = messages
        .slice()
        .sort(
            (a, b) =>
                new Date(b.datetime).valueOf() - new Date(a.datetime).valueOf(),
        );

    const uniqueThreads = sortedMessages
        .map((message) => getThreadIdentifier(message))
        .filter((id, index, arr) => arr.indexOf(id) === index);

    const threads = uniqueThreads.map((id) => {
        const threadMessages = messages.filter(
            (message) => getThreadIdentifier(message) === id,
        );

        return {
            id,
            threadMessages,
            lastMessage: threadMessages[threadMessages.length - 1],
        };
    });

    const navigate = useNavigate();

    const onThread = (threadId: string) => {
        navigate(`/fractal/${currentFractal}/support/${threadId}`);
    };

    if (isLoading) {
        return <LoadingBlock />;
    }

    return (
        <div className="mx-auto w-full max-w-screen-xl">
            <div className="mb-6">
                <h1 className="text-3xl font-bold tracking-tight">
                    Support Messages
                </h1>
                <p className="mt-1 text-muted-foreground">
                    Manage your support conversations
                </p>
            </div>

            <ScrollArea className="h-full">
                {threads.length > 0 ? (
                    <div className="flex h-full w-full flex-col space-y-4">
                        {threads.map((thread) => (
                            <button
                                key={thread.id}
                                onClick={() => onThread(thread.id)}
                                className="flex w-full flex-col items-start gap-2 rounded-lg border p-4 text-left text-sm transition-all hover:bg-muted/50 hover:shadow-md"
                            >
                                <div className="flex w-full flex-col gap-2">
                                    <div className="flex items-center">
                                        <div className="flex items-center gap-3">
                                            <div className="flex size-7 items-center justify-center rounded-sm border">
                                                <img
                                                    src={createIdenticon(
                                                        chainId +
                                                            thread.lastMessage
                                                                .sender,
                                                    )}
                                                />
                                            </div>
                                            <div>
                                                <div className="font-semibold">
                                                    {thread.lastMessage.sender}
                                                </div>
                                                <div className="text-xs text-muted-foreground">
                                                    {dayjs(
                                                        thread.lastMessage
                                                            .datetime,
                                                    ).fromNow()}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="ml-auto">
                                            <div className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2">
                                                {thread.threadMessages.length}{" "}
                                                {thread.threadMessages
                                                    .length === 1
                                                    ? "message"
                                                    : "messages"}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="text-sm font-medium">
                                        {removeReplyPrefix(
                                            thread.lastMessage.subject,
                                        )}
                                    </div>
                                    <div className="line-clamp-2 text-sm text-muted-foreground">
                                        {thread.lastMessage.body}
                                    </div>
                                </div>
                            </button>
                        ))}
                    </div>
                ) : (
                    <EmptyBlock
                        title="No support requests yet"
                        description="When you receive support messages through Chainmail, they will appear here."
                    />
                )}
            </ScrollArea>
        </div>
    );
};
