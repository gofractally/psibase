import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@shared/shadcn/ui/card";
import { Avatar, AvatarImage } from "@shared/shadcn/ui/avatar";
import { Separator } from "@shared/shadcn/ui/separator";
import { Textarea } from "@shared/shadcn/ui/textarea";
import { Button } from "@shared/shadcn/ui/button";
import { useMail } from "@/hooks/useMail";
import { useMessages } from "@/hooks/useMessages";
import { useCurrentApp } from "@/hooks/useCurrentApp";
import { LoadingBlock } from "@/components/LoadingBlock";
import { useCurrentThreadId } from "@/hooks/useCurrentThreadId";
import { getThreadIdentifier } from "@/lib/createThreadIdentifier";
import { Account } from "@/lib/zodTypes";
import dayjs from "dayjs";
import { useChainId } from "@/hooks/use-chain-id";
import { createIdenticon } from "@/lib/createIdenticon";
import { RefreshCcw } from "lucide-react";
import { toast } from "@shared/shadcn/ui/sonner";
import humanizeDuration from "humanize-duration";

export const Thread: React.FC = () => {
  const [newMessage, setNewMessage] = React.useState("");
  const currentApp = useCurrentApp();

  const { data: chainId } = useChainId();

  const {
    data: appMessagesT,
    isLoading,
    refetch: refetchAppMessages,
    isFetching: isFetchingAppMessages,
  } = useMessages(currentApp);
  const appMessages = appMessagesT ? appMessagesT : [];

  const { mutateAsync: mailAction } = useMail();

  const threadId = useCurrentThreadId();

  const latestMessage = appMessages[0];
  const subject = latestMessage ? latestMessage.subject : "";
  const customer = latestMessage && latestMessage.sender;

  const {
    data: customerMessages,
    refetch: refetchCustomerMessages,
    isFetching: isFetchingCustomerMessages,
  } = useMessages(customer);

  const threadCustomerMessages = (customerMessages || []).filter(
    (message) => getThreadIdentifier(message, false) == threadId
  );

  const threadAppMessages = appMessages.filter(
    (message) => getThreadIdentifier(message) === threadId
  );

  const combinedMessages = [
    ...threadCustomerMessages,
    ...threadAppMessages,
  ].sort((a, b) => dayjs(a.datetime).valueOf() - dayjs(b.datetime).valueOf());

  const firstMessage = combinedMessages[0];

  const ageSeconds = firstMessage
    ? dayjs().diff(firstMessage.datetime, "milliseconds")
    : false;

  const sendMessage = async (message: string) => {
    mailAction({
      app: Account.parse(currentApp),
      body: message,
      method: "send",
      receiver: customer,
      subject: threadAppMessages[0].subject,
    });
  };

  const handleMessageSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(newMessage);
    setNewMessage("");
  };

  const refresh = async () => {
    toast("Fetching messages...");
    await Promise.all([refetchCustomerMessages(), refetchAppMessages()]);
    toast("Fetched messages");
  };

  const isRefreshing = isFetchingCustomerMessages || isFetchingAppMessages;

  if (isLoading) {
    return <LoadingBlock />;
  }

  return (
    <Card className="w-full flex-1 min-h-0 max-w-screen-xl mx-auto border flex flex-col ">
      <CardHeader className="border-b">
        <div className="flex justify-between items-center">
          <CardTitle>{subject}</CardTitle>
          <Button
            disabled={isRefreshing}
            onClick={() => {
              refresh();
            }}
            variant="outline"
          >
            <RefreshCcw />
          </Button>
        </div>
      </CardHeader>
      <div className="flex flex-col md:flex-row flex-1 min-h-0 overflow-hidden">
        <div className="md:w-2/3 border-r flex flex-col overflow-hidden">
          <div className="p-4 flex-1 overflow-y-auto">
            {combinedMessages.map((message) => {
              const isCustomer = message.sender !== currentApp;
              return (
                <div
                  key={message.msgId}
                  className={`mb-4 flex ${
                    isCustomer ? "justify-end" : "justify-start"
                  }`}
                >
                  <div
                    className={`flex items-start space-x-2 max-w-[70%] ${
                      isCustomer ? "flex-row-reverse space-x-reverse" : ""
                    }`}
                  >
                    <Avatar className="mt-1 rounded-none">
                      <AvatarImage
                        src={createIdenticon(chainId + message.sender)}
                      />
                    </Avatar>
                    <div className={`bg-muted p-3 rounded-lg `}>
                      <p className="text-sm  text-muted-foreground">
                        {message.sender}
                      </p>
                      <p className="text-sm">{message.body}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {dayjs(message.datetime).format("YYYY-MM-DD HH:mm:ss")}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="p-4 border-t ">
            <form onSubmit={handleMessageSubmit}>
              <Textarea
                placeholder="Type your message..."
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                className="mb-2"
              />
              <Button type="submit">Send Message</Button>
            </form>
          </div>
        </div>
        <CardContent className="p-6 md:w-1/3">
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold mb-2">Ticket Details</h3>
              <p className="text-sm text-muted-foreground">
                Ticket ID: {threadId}
              </p>
              {ageSeconds && (
                <p className="text-sm text-muted-foreground">
                  Age:{" "}
                  {humanizeDuration(ageSeconds, {
                    units: ["y", "mo", "w", "d", "h", "m"],
                    round: true,
                  })}
                </p>
              )}
            </div>

            <Separator />
            <div>
              <h3 className="text-lg font-semibold mb-2">Customer</h3>
              <div className="flex items-center space-x-4">
                <Avatar>
                  <AvatarImage
                    src={createIdenticon(chainId + customer)}
                    alt={customer}
                  />
                </Avatar>
                <div>
                  <p className="text-sm font-medium">{customer}</p>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </div>
    </Card>
  );
};
