import { useEffect, useRef, useState, type ReactNode } from "react";

import { type PluginId, Supervisor } from "@psibase/common-lib";

import { PencilIcon, Reply, SquarePen } from "lucide-react";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { Button } from "@shadcn/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@shadcn/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@shadcn/tooltip";
import { Separator } from "@shadcn/separator";
import { MarkdownEditor } from "@components";
import { ControlBar } from "@components/editor";
import { type Message, useDraftMessages, useUser } from "@hooks";
import { ScrollArea } from "@shadcn/scroll-area";
import { MilkdownProvider } from "@milkdown/react";
import { ProsemirrorAdapterProvider } from "@prosemirror-adapter/react";
import { v4 as uuid } from "uuid";
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormMessage,
} from "@shadcn/form";
import { Input } from "@shadcn/input";

const supervisor = new Supervisor();
interface SupervisorError {
    code: number;
    producer: PluginId;
    message: string;
}

const formSchema = z.object({
    to: z.string(),
    subject: z.string(),
});

export const ComposeDialog = ({
    trigger,
    message,
}: {
    trigger: ReactNode;
    message?: Message;
}) => {
    const [open, setOpen] = useState(false);
    const [selectedAccount] = useUser();
    const { drafts, setDrafts, getDrafts, deleteDraftById } =
        useDraftMessages();

    const form = useForm<z.infer<typeof formSchema>>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            subject: "",
        },
    });

    useEffect(() => {
        if (!message) {
            return form.reset();
        }
        if (message.status === "draft") {
            form.setValue("to", message.to);
            form.setValue("subject", message.subject);
        } else {
            form.setValue("to", message.from);
            form.setValue("subject", `RE: ${message.subject}`);
        }
    }, [message]);

    const id = useRef<string>();

    const createDraft = (value: string) => {
        const draft = {
            id: id.current,
            from: selectedAccount.account,
            to: form.getValues().to || "recipient",
            datetime: Date.now(),
            status: "draft",
            inReplyTo: null,
            subject: form.getValues().subject || "subject here",
            body: value,
        } as Message;
        setDrafts([...(drafts ?? []), draft]);
    };

    const updateDraft = (value: string) => {
        // using getDrafts() here instead of messages prevents stale closure
        const data = getDrafts() ?? [];
        let draft = data.find((msg) => msg.id === id.current);
        if (!draft) {
            createDraft(value);
        } else {
            draft.datetime = Date.now();
            draft.to = form.getValues().to ?? "";
            draft.subject = form.getValues().subject ?? "";
            draft.body = value;
            setDrafts(data);
        }
    };

    const sendMessage = async (values: z.infer<typeof formSchema>) => {
        // using getDrafts() here instead of messages prevents stale closure
        const data = getDrafts() ?? [];
        let draft = data.find((msg) => msg.id === id.current);
        if (!draft) {
            return console.error("No message found to send");
        }

        try {
            await supervisor.functionCall({
                service: "webmail",
                intf: "api",
                method: "send",
                params: [draft.to, draft.subject, draft.body],
            });
            if (!id.current) return;
            deleteDraftById(id.current);
        } catch (e: unknown) {
            alert(`${(e as SupervisorError).message}`);
            console.error(`${(e as SupervisorError).message}`);
        }
    };

    async function onSubmit(values: z.infer<typeof formSchema>) {
        await sendMessage(values);
        form.reset();
        setOpen(false);
    }

    return (
        <Dialog
            open={open}
            onOpenChange={(open) => {
                setOpen(open);
                if (!open) return;

                // the ID should be (re)set each time this opens; remember, it stays mounted
                if (message?.status === "draft") {
                    id.current = message.id;
                } else {
                    id.current = uuid();
                }
            }}
        >
            {trigger}
            <DialogContent
                className="flex h-[90dvh] max-w-screen-2xl flex-col"
                onCloseAutoFocus={(e) => {
                    // This helps in not focusing on the trigger after closing the modal
                    e.preventDefault();
                }}
            >
                <DialogHeader>
                    <DialogTitle>Compose message</DialogTitle>
                    <DialogDescription>
                        Send a message to another account on the network
                    </DialogDescription>
                </DialogHeader>
                <Separator />
                <Form {...form}>
                    <form
                        onSubmit={form.handleSubmit(onSubmit)}
                        className="flex flex-1 flex-col space-y-2"
                    >
                        <FormField
                            control={form.control}
                            name="to"
                            render={({ field }) => (
                                <FormItem>
                                    <FormControl>
                                        <Input placeholder="To" {...field} />
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
                                        />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <ScrollArea className="flex-1">
                            <MilkdownProvider>
                                <ProsemirrorAdapterProvider>
                                    <div className="sticky top-0 z-10 bg-white/50 backdrop-blur">
                                        <ControlBar />
                                        <Separator />
                                    </div>
                                    <MarkdownEditor
                                        initialValue={
                                            message?.status === "draft"
                                                ? message.body
                                                : ""
                                        }
                                        updateMarkdown={updateDraft}
                                    />
                                </ProsemirrorAdapterProvider>
                            </MilkdownProvider>
                        </ScrollArea>
                        <DialogFooter>
                            <Button type="submit">Send</Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    );
};

export const ComposeDialogTriggerIconWithTooltip = ({
    disabled = false,
}: {
    disabled?: boolean;
}) => {
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <DialogTrigger asChild>
                    <Button
                        variant="ghost"
                        size="icon"
                        disabled={disabled}
                        className="my-2"
                    >
                        <SquarePen className="h-4 w-4" />
                        <span className="sr-only">Compose</span>
                    </Button>
                </DialogTrigger>
            </TooltipTrigger>
            <TooltipContent>Compose</TooltipContent>
        </Tooltip>
    );
};

export const ReplyDialogTriggerIconWithTooltip = ({
    disabled = false,
}: {
    disabled?: boolean;
}) => {
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <DialogTrigger asChild>
                    <Button variant="ghost" size="icon" disabled={disabled}>
                        <Reply className="h-4 w-4" />
                        <span className="sr-only">Reply</span>
                    </Button>
                </DialogTrigger>
            </TooltipTrigger>
            <TooltipContent>Reply</TooltipContent>
        </Tooltip>
    );
};

export const EditSendDialogTriggerIconWithTooltip = ({
    disabled = false,
}: {
    disabled?: boolean;
}) => {
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <DialogTrigger asChild>
                    <Button variant="ghost" size="icon" disabled={disabled}>
                        <PencilIcon className="h-4 w-4" />
                        <span className="sr-only">Edit &amp; Send</span>
                    </Button>
                </DialogTrigger>
            </TooltipTrigger>
            <TooltipContent>Edit &amp; Send</TooltipContent>
        </Tooltip>
    );
};
