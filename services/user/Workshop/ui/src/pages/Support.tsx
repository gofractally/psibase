import { useCurrentApp } from "@/hooks/useCurrentApp";
import { useMessages } from "@/hooks/useMessages";

export const Support = () => {
  const currentApp = useCurrentApp();

  const { data: messages } = useMessages(currentApp);

  const uniqueByUser = messages
    ? messages.filter(
        (message, index, arr) =>
          arr.findIndex((m) => m.sender == message.sender) == index
      )
    : [];

  console.log({ messages, uniqueUsers: uniqueByUser });
  return (
    <div className="mx-auto max-w-screen-xl">
      <div className="flex flex-col gap-2">
        {uniqueByUser.map((message) => (
          <div key={message.sender} className="flex justify-between">
            <div className="flex flex-col">
                <div>{message.sender}</div>
                <div>{message.subject}</div>
                <div>{message.body}</div>
                
            </div>
            <div>{}</div>
          </div>
        ))}
      </div>
    </div>
  );
};
