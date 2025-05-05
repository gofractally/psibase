import dayjs from "dayjs";
import humanizeDuration from "humanize-duration";
import { RefreshCcw } from "lucide-react";
import React from "react";
import { toast } from "sonner";

import { Avatar, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";

import { LoadingBlock } from "@/components/LoadingBlock";

import { useChainId } from "@/hooks/use-chain-id";
import { useCurrentFractal } from "@/hooks/useCurrentFractal";
import { useCurrentThreadId } from "@/hooks/useCurrentThreadId";
import { useMail } from "@/hooks/useMail";
import { useMessages } from "@/hooks/useMessages";
import { createIdenticon } from "@/lib/createIdenticon";
import { getThreadIdentifier } from "@/lib/createThreadIdentifier";
import { Account } from "@/lib/zodTypes";

export const Thread: React.FC = () => {
    const [newMessage, setNewMessage] = React.useState("");
    const currentFractal = useCurrentFractal();

    const { data: chainId } = useChainId();

    const {
        data: appMessagesT,
        isLoading,
        refetch: refetchAppMessages,
        isFetching: isFetchingAppMessages,
    } = useMessages(currentFractal);
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
        (message) => getThreadIdentifier(message, false) == threadId,
    );

    const threadAppMessages = appMessages.filter(
        (message) => getThreadIdentifier(message) === threadId,
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
            app: Account.parse(currentFractal),
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
        <Card className="mx-auto flex min-h-0 w-full max-w-screen-xl flex-1 flex-col border ">
            <CardHeader className="border-b">
                <div className="flex items-center justify-between">
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
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
                <div className="flex flex-col overflow-hidden border-r md:w-2/3">
                    <div className="flex-1 overflow-y-auto p-4">
                        {combinedMessages.map((message) => {
                            const isCustomer =
                                message.sender !== currentFractal;
                            return (
                                <div
                                    key={message.msgId}
                                    className={`mb-4 flex ${
                                        isCustomer
                                            ? "justify-end"
                                            : "justify-start"
                                    }`}
                                >
                                    <div
                                        className={`flex max-w-[70%] items-start space-x-2 ${
                                            isCustomer
                                                ? "flex-row-reverse space-x-reverse"
                                                : ""
                                        }`}
                                    >
                                        <Avatar className="mt-1 rounded-none">
                                            <AvatarImage
                                                src={createIdenticon(
                                                    chainId + message.sender,
                                                )}
                                            />
                                        </Avatar>
                                        <div
                                            className={`rounded-lg bg-muted p-3 `}
                                        >
                                            <p className="text-sm  text-muted-foreground">
                                                {message.sender}
                                            </p>
                                            <p className="text-sm">
                                                {message.body}
                                            </p>
                                            <p className="mt-1 text-xs text-muted-foreground">
                                                {dayjs(message.datetime).format(
                                                    "YYYY-MM-DD HH:mm:ss",
                                                )}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                    <div className="border-t p-4 ">
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
                            <h3 className="mb-2 text-lg font-semibold">
                                Ticket Details
                            </h3>
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
                            <h3 className="mb-2 text-lg font-semibold">
                                Customer
                            </h3>
                            <div className="flex items-center space-x-4">
                                <Avatar>
                                    <AvatarImage
                                        src={createIdenticon(
                                            chainId + customer,
                                        )}
                                        alt={customer}
                                    />
                                </Avatar>
                                <div>
                                    <p className="text-sm font-medium">
                                        {customer}
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                </CardContent>
            </div>
        </Card>
    );
};
