import { useCurrentApp } from "@/hooks/useCurrentApp";
import { type MessageType, useMessages } from "@/hooks/useMessages";
import { ScrollArea } from "@/components/ui/scroll-area";
import dayjs from "dayjs";
import relative from "dayjs/plugin/relativeTime";
import { useNavigate } from "react-router-dom";

dayjs.extend(relative);

const getIdentifier = (message: MessageType) =>
  message.sender + message.subject;

export const Support = () => {
  const currentApp = useCurrentApp();
  const { data: dataMessages } = useMessages(currentApp);
  const messages = dataMessages ? dataMessages : [];

  const sortedMessages = messages
    .slice()
    .sort(
      (a, b) => new Date(b.datetime).valueOf() - new Date(a.datetime).valueOf()
    );

  const uniqueUsersAndSubject = sortedMessages
    .map(getIdentifier)
    .filter((id, index, arr) => arr.indexOf(id) === index);

  const threads = uniqueUsersAndSubject?.map((id) => {
    const threadMessages = messages.filter(
      (message) => getIdentifier(message) === id
    );

    return {
      id,
      threadMessages,
      lastMessage: threadMessages[threadMessages.length - 1],
    };
  });

  const navigate = useNavigate();

  const onThread = (threadId: string) => {
    console.log("Thread clicked:", threadId);
    navigate(`/app/${currentApp}/support/${threadId}`);
    // Implement your thread handling logic here
  };

  return (
    <div className="mx-auto max-w-screen-xl w-full ">
      <ScrollArea className="h-full">
        <div className="space-y-4 flex flex-col w-full border border-sm p-4">
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
                  {thread.lastMessage.subject}
                </div>
              </div>
              <div className="line-clamp-2 text-xs text-muted-foreground">
                {thread.lastMessage.body}
              </div>
            </button>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
};
