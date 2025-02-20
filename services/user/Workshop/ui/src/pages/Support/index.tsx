import { useCurrentApp } from "@/hooks/useCurrentApp";
import { useMessages } from "@/hooks/useMessages";
import { ScrollArea } from "@/components/ui/scroll-area";
import dayjs from "dayjs";
import relative from "dayjs/plugin/relativeTime";
import { useNavigate } from "react-router-dom";
import { EmptyBlock } from "@/components/EmptyBlock";
import { LoadingBlock } from "@/components/LoadingBlock";
import {
  getThreadIdentifier,
  removeReplyPrefix,
} from "@/lib/createThreadIdentifier";

dayjs.extend(relative);

export const Support = () => {
  const currentApp = useCurrentApp();
  const { data: dataMessages, isLoading } = useMessages(currentApp);
  const messages = dataMessages ? dataMessages : [];

  const sortedMessages = messages
    .slice()
    .sort(
      (a, b) => new Date(b.datetime).valueOf() - new Date(a.datetime).valueOf()
    );

  const uniqueThreads = sortedMessages
    .map((message) => getThreadIdentifier(message))
    .filter((id, index, arr) => arr.indexOf(id) === index);

  const threads = uniqueThreads.map((id) => {
    const threadMessages = messages.filter(
      (message) => getThreadIdentifier(message) === id
    );

    return {
      id,
      threadMessages,
      lastMessage: threadMessages[threadMessages.length - 1],
    };
  });

  const navigate = useNavigate();

  const onThread = (threadId: string) => {
    navigate(`/app/${currentApp}/support/${threadId}`);
  };

  if (isLoading) {
    return <LoadingBlock />;
  }

  return (
    <div className="mx-auto max-w-screen-xl w-full">
      <ScrollArea className="h-full">
        {threads.length > 0 ? (
          <div className="border border-sm space-y-4 h-full flex flex-col w-full  p-4">
            {threads.map((thread) => (
              <button
                onClick={() => {
                  onThread(thread.id);
                }}
                className="flex flex-col items-start w-full gap-2 rounded-lg border p-3 text-left text-sm transition-all hover:bg-muted"
              >
                <div className="flex w-full flex-col gap-1">
                  <div className="flex items-center">
                    <div className="flex items-center gap-2">
                      <div className="font-semibold">
                        {thread.lastMessage.sender}
                      </div>
                    </div>
                    <div className="ml-auto text-xs text-foreground">
                      {dayjs(thread.lastMessage.datetime).fromNow()}
                    </div>
                  </div>
                  <div className="text-xs font-medium">
                    {removeReplyPrefix(thread.lastMessage.subject)}
                  </div>
                </div>
                <div className="line-clamp-2 text-xs text-muted-foreground">
                  {thread.lastMessage.body}
                </div>
              </button>
            ))}
          </div>
        ) : (
          <EmptyBlock
            title="No support requests"
            description="Chainmail messages will appear here."
          />
        )}
      </ScrollArea>
    </div>
  );
};
