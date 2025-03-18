import type { Message } from "@/apps/chainmail/types";
import type { PluginId } from "@psibase/common-lib";

import { zodResolver } from "@hookform/resolvers/zod";
import { PencilIcon, Reply, Send, SquarePen, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { supervisor } from "@/supervisor";

import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@/components/ui/tooltip";

import { AwaitTime } from "@/globals";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { wait } from "@/lib/wait";
import { Account } from "@/lib/zod/Account";

import {
    useDraftMessages,
    useInvalidateMailboxQueries,
} from "../hooks/use-mail";

interface SupervisorError {
    code: number;
    producer: PluginId;
    message: string;
}

const formSchema = z.object({
    to: Account,
    subject: z.string(),
    message: z.string(),
});

export function ComposeDialog({
    trigger,
    message,
}: {
    trigger: React.ReactNode;
    message?: Message;
}) {
    const [open, setOpen] = useState(false);
    const isSent = useRef(false);
    const { data: user } = useCurrentUser();
    const { allDrafts, setDrafts, deleteDraftById } = useDraftMessages();
    const invalidateMailboxQueries = useInvalidateMailboxQueries();

    const form = useForm<z.infer<typeof formSchema>>({
        resolver: zodResolver(formSchema),
    });

    useEffect(() => {
        if (!message) {
            return form.reset();
        }
        if (message.isDraft) {
            form.setValue("to", message.to);
            form.setValue("subject", message.subject);
            form.setValue("message", message.body);
        } else {
            form.setValue("to", message.from);
            form.setValue("subject", `RE: ${message.subject}`);
        }
    }, [message]);

    const id = useRef<string>();

    const createDraft = () => {
        if (!id.current || !user) return;
        const draft: Message = {
            id: id.current,
            msgId: id.current,
            from: user,
            to: form.getValues().to || "recipient",
            datetime: Date.now(),
            isDraft: true,
            type: "outgoing",
            read: true,
            saved: true,
            inReplyTo: null,
            subject: form.getValues().subject || "subject here",
            body: form.getValues().message ?? "",
        };
        setDrafts([...(allDrafts ?? []), draft]);
    };

    const updateDraft = () => {
        let draft = allDrafts.find((msg) => msg.id === id.current);
        if (!draft) {
            createDraft();
        } else {
            draft.datetime = Date.now();
            draft.to = form.getValues().to ?? "";
            draft.subject = form.getValues().subject ?? "";
            draft.body = form.getValues().message ?? "";
            setDrafts(allDrafts);
        }
    };

    const sendMessage = async (values: z.infer<typeof formSchema>) => {
        let draft = allDrafts.find((msg) => msg.id === id.current);
        if (!draft) {
            return console.error("No message found to send");
        }

        const loadingId = toast.loading("Sending message");

        try {
            // TODO: Improve error detection. This promise resolves with success before the transaction is pushed.
            await supervisor.functionCall({
                service: "chainmail",
                intf: "api",
                method: "send",
                params: [draft.to, draft.subject, draft.body],
            });
            if (!id.current) return;
            deleteDraftById(id.current);
            isSent.current = true;
            form.reset();
            toast.success("Your message has been sent");
            setOpen(false);
        } catch (e: unknown) {
            toast.error(`${(e as SupervisorError).message}`);
            console.error(`${(e as SupervisorError).message}`);
        } finally {
            toast.dismiss(loadingId);
        }
    };

    async function onSubmit(values: z.infer<typeof formSchema>) {
        toast("Sending...");
        await sendMessage(values);
        await wait(AwaitTime);
        invalidateMailboxQueries(["sent"]);
    }

    const onOpenChange = (open: boolean) => {
        setOpen(open);
        if (!open) {
            // if closing
            if (isSent.current) return;
            if (form.getValues().message.length) {
                toast.success("Your draft has been saved");
            }
            form.reset();
        }

        // the ID should be (re)set each time this opens; remember, it stays mounted
        isSent.current = false;
        if (message?.isDraft) {
            id.current = message.id;
        } else {
            id.current =
                window.crypto.randomUUID?.() ?? Math.random().toString();
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            {trigger}
            <DialogContent
                className="h-[100dvh] max-w-full rounded-none px-4 py-8 sm:h-auto sm:max-w-[600px] sm:p-6"
                onCloseAutoFocus={(e) => {
                    // This helps in not focusing on the trigger after closing the modal
                    e.preventDefault();
                }}
            >
                <Form {...form}>
                    <form
                        onSubmit={form.handleSubmit(onSubmit)}
                        className="flex h-full flex-col"
                    >
                        <DialogHeader>
                            <DialogTitle>Compose New Message</DialogTitle>
                            <DialogDescription>
                                Send a message to other accounts on chain. This
                                is for demo purposes only. All messages are
                                stored on chain unencrypted and are publicly
                                readable.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="flex flex-grow flex-col gap-4 py-4 sm:grid">
                            <FormField
                                control={form.control}
                                name="to"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormControl>
                                            <Input
                                                placeholder="Recipient account name"
                                                {...field}
                                                onChange={(e) => {
                                                    field.onChange(e);
                                                    updateDraft();
                                                }}
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="subject"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormControl>
                                            <Input
                                                placeholder="Subject"
                                                {...field}
                                                onChange={(e) => {
                                                    field.onChange(e);
                                                    updateDraft();
                                                }}
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="message"
                                render={({ field }) => (
                                    <FormItem className="flex flex-1 flex-col">
                                        <FormControl>
                                            <Textarea
                                                placeholder="Message"
                                                className="h-full resize-none text-sm sm:min-h-[200px]"
                                                {...field}
                                                onChange={(e) => {
                                                    field.onChange(e);
                                                    updateDraft();
                                                }}
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>
                        <DialogFooter className="flex flex-col-reverse gap-2 pb-4 sm:flex-row sm:justify-between sm:space-x-2 sm:pb-0">
                            <Button
                                variant="outline"
                                onClick={(e) => {
                                    e.preventDefault();
                                    onOpenChange(false);
                                }}
                                className="w-full sm:w-auto"
                                type="button"
                            >
                                <X className="mr-2 h-4 w-4" />
                                Cancel
                            </Button>
                            <AlertDialog>
                                <AlertDialogTrigger asChild>
                                    <Button className="w-full sm:w-auto">
                                        <Send className="mr-2 h-4 w-4" />
                                        Send Message
                                    </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                    <AlertDialogHeader>
                                        <AlertDialogTitle>
                                            Messages are not private
                                        </AlertDialogTitle>
                                        <AlertDialogDescription>
                                            Chain Mail is for demonstration
                                            purposes only. Messages are not
                                            currently encrypted and are stored
                                            on a publicly accessible blockchain,
                                            visible to anyone.
                                        </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                        <AlertDialogCancel>
                                            Cancel
                                        </AlertDialogCancel>
                                        <AlertDialogAction
                                            onClick={async () => {
                                                await form.trigger();
                                                if (form.formState.isValid)
                                                    onSubmit(form.getValues());
                                            }}
                                        >
                                            Send
                                        </AlertDialogAction>
                                    </AlertDialogFooter>
                                </AlertDialogContent>
                            </AlertDialog>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    );
}

export default ComposeDialog;

export const ComposeDialogTrigger = ({
    disabled = false,
}: {
    disabled?: boolean;
}) => {
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <DialogTrigger asChild>
                    <Button variant="ghost" size="icon" disabled={disabled}>
                        <SquarePen className="h-5 w-5" />
                    </Button>
                </DialogTrigger>
            </TooltipTrigger>
            <TooltipContent>Compose</TooltipContent>
        </Tooltip>
    );
};

export const ReplyDialogTrigger = ({
    disabled = false,
}: {
    disabled?: boolean;
}) => {
    return (
        <DialogTrigger asChild>
            <Button variant="outline" disabled={disabled}>
                <Reply className="mr-2 h-5 w-5" />
                Reply
            </Button>
        </DialogTrigger>
    );
};

export const EditSendDialogTrigger = ({
    disabled = false,
}: {
    disabled?: boolean;
}) => {
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <DialogTrigger asChild>
                    <Button variant="ghost" size="icon" disabled={disabled}>
                        <PencilIcon className="h-5 w-5" />
                    </Button>
                </DialogTrigger>
            </TooltipTrigger>
            <TooltipContent>Edit &amp; Send</TooltipContent>
        </Tooltip>
    );
};
