import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
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

const ticketData = {
  id: "TICKET-1234",
  title: "Unable to access dashboard",
  status: "In Progress",
  assignee: {
    name: "Alice Johnson",
    avatar: "/placeholder-avatar.jpg",
    initials: "AJ",
  },
  customer: {
    name: "John Doe",
    avatar: "/placeholder-customer.jpg",
    initials: "JD",
  },
  messages: [
    {
      id: 1,
      author: "John Doe",
      content:
        'I can\'t access the dashboard after the recent update. It shows "Access Denied".',
      timestamp: "2 hours ago",
      isCustomer: true,
    },
    {
      id: 2,
      author: "Alice Johnson",
      content:
        "Thank you for reporting this, John. I'm looking into the issue now.",
      timestamp: "1 hour 45 minutes ago",
      isCustomer: false,
    },
    {
      id: 3,
      author: "John Doe",
      content: "Any updates on this? I really need to access my dashboard.",
      timestamp: "1 hour ago",
      isCustomer: true,
    },
    {
      id: 4,
      author: "Alice Johnson",
      content: `I've identified the problem. It seems to be related to a permissions issue. I'm working on a fix now.`,
      timestamp: "30 minutes ago",
      isCustomer: false,
    },
  ],
};

export const Thread: React.FC = () => {
  const [newMessage, setNewMessage] = React.useState("");
  const currentApp = useCurrentApp();

  const { data: chainId } = useChainId();

  const { data: appMessagesT, isLoading } = useMessages(currentApp);
  const appMessages = appMessagesT ? appMessagesT : [];

  const { mutateAsync: mailAction } = useMail();

  const threadId = useCurrentThreadId();

  const latestMessage = appMessages[0];
  const subject = latestMessage ? latestMessage.subject : "";
  const customer = latestMessage && latestMessage.sender;

  const { data: customerMessages } = useMessages(customer);

  const threadCustomerMessages = (customerMessages || []).filter(
    (message) => getThreadIdentifier(message, false) == threadId
  );

  const threadAppMessages = appMessages.filter(
    (message) => getThreadIdentifier(message) === threadId
  );
  console.log({ threadMessages: threadAppMessages });

  const combinedMessages = [
    ...threadCustomerMessages,
    ...threadAppMessages,
  ].sort((a, b) => dayjs(a.datetime).valueOf() - dayjs(b.datetime).valueOf());

  console.log(combinedMessages, "are the combined messages");

  const sendMessage = async (message: string) => {
    mailAction({
      app: Account.parse(currentApp),
      body: message,
      method: "send",
      receiver: "a",
      subject: threadAppMessages[0].subject,
    });
    console.log(message);
  };

  const handleMessageSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(newMessage);
    setNewMessage("");
  };

  if (isLoading) {
    return <LoadingBlock />;
  }

  return (
    <Card className="w-full h-dvh max-w-screen-xl mx-auto">
      <CardHeader className="border-b">
        <div className="flex justify-between items-center">
          <CardTitle>{subject}</CardTitle>
        </div>
      </CardHeader>
      <div className="flex flex-col md:flex-row">
        <div className="md:w-2/3 border-r">
          <div className="p-4 h-[calc(100vh-200px)] overflow-y-auto">
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
                      <p className="text-sm font-medium">{message.sender}</p>
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
          <div className="p-4 border-t">
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
              <p className="text-sm text-muted-foreground">Status unknown</p>
            </div>

            <Separator />
            <div>
              <h3 className="text-lg font-semibold mb-2">Customer</h3>
              <div className="flex items-center space-x-4">
                <Avatar>
                  <AvatarImage
                    src={ticketData.customer.avatar}
                    alt={ticketData.customer.name}
                  />
                  <AvatarFallback>
                    {ticketData.customer.initials}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <p className="text-sm font-medium">
                    {ticketData.customer.name}
                  </p>
                  <p className="text-sm text-muted-foreground">Customer</p>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </div>
    </Card>
  );
};
