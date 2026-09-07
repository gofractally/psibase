import type { DraftMessage, Message } from "@/apps/chainmail/types";
import type { PluginId } from "@psibase/common-lib";

import { PencilIcon, Reply, Send, SquarePen, X } from "lucide-react";
import { forwardRef, useRef, useState } from "react";
import { z } from "zod";

import { zDraftMessage } from "@/apps/chainmail/types";

import { useAppForm } from "@shared/components/form/app-form";
import { FieldAccountExisting } from "@shared/components/form/field-account-existing";
import { FieldErrors } from "@shared/components/form/internal/field-errors";
import { useCurrentUser } from "@shared/hooks/use-current-user";
import { zAccount } from "@shared/lib/schemas/account";
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
} from "@shared/shadcn/ui/alert-dialog";
import { Button, type ButtonProps } from "@shared/shadcn/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@shared/shadcn/ui/dialog";
import { Input } from "@shared/shadcn/ui/input";
import { Label } from "@shared/shadcn/ui/label";
import { toast } from "@shared/shadcn/ui/sonner";
import { Textarea } from "@shared/shadcn/ui/textarea";
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@shared/shadcn/ui/tooltip";

import {
    useDraftMessages,
    useInvalidateMailboxQueries,
    useSendMessage,
} from "../hooks/use-mail";

interface SupervisorError {
    code: number;
    producer: PluginId;
    message: string;
}

export const zSendMessageSchema = z.object({
    to: zAccount,
    subject: z.string().min(1),
    message: z.string().min(1),
});

const defaultComposeValues = {
    to: {
        account: "",
    },
    subject: "",
    message: "",
};

const hasDraftContent = (values: typeof defaultComposeValues) =>
    Boolean(
        values.to.account.trim() ||
            values.subject.trim() ||
            values.message.trim(),
    );

export function ComposeDialog({
    trigger,
    message,
}: {
    trigger: React.ReactNode;
    message?: Message | DraftMessage;
}) {
    const [open, setOpen] = useState(false);
    const isSent = useRef(false);
    const { data: user } = useCurrentUser();
    const { allDrafts, setDrafts, deleteDraftById } = useDraftMessages();
    const { mutateAsync } = useSendMessage();
    const invalidateMailboxQueries = useInvalidateMailboxQueries();

    const id = useRef<string>("");

    const form = useAppForm({
        defaultValues: defaultComposeValues,
        validators: {
            onSubmit: z.object({
                to: z.object({
                    account: z.string(),
                }),
                subject: z.string().min(1),
                message: z.string().min(1),
            }),
        },
        onSubmit: async ({ value }) => {
            const loadingId = toast.loading("Sending message");

            try {
                // TODO: Improve error detection. This promise resolves with success before the transaction is pushed.
                await mutateAsync({
                    to: value.to.account,
                    subject: value.subject,
                    message: value.message,
                });
                if (!id.current) return;
                deleteDraftById(id.current);
                isSent.current = true;
                form.reset();
                toast.success("Your message has been sent");
                setOpen(false);
                invalidateMailboxQueries(["sent"]);
            } catch (e: unknown) {
                toast.error(`${(e as SupervisorError).message}`);
                console.error(`${(e as SupervisorError).message}`);
            } finally {
                toast.dismiss(loadingId);
            }
        },
    });

    const populateFormFromMessage = () => {
        if (!message) {
            form.reset();
            return;
        }
        if (message.isDraft) {
            form.setFieldValue("to", { account: message.to });
            form.setFieldValue("subject", message.subject);
            form.setFieldValue("message", message.body);
        } else {
            form.setFieldValue("to", { account: message.from });
            form.setFieldValue("subject", `RE: ${message.subject}`);
            form.setFieldValue("message", "");
        }
    };

    const createDraft = () => {
        if (!id.current || !user) return;
        const values = form.state.values;
        if (!hasDraftContent(values)) return;

        const draft = zDraftMessage.parse({
            id: id.current,
            from: user,
            to: values.to.account.trim(),
            datetime: Date.now(),
            isDraft: true,
            type: "outgoing",
            read: true,
            saved: true,
            inReplyTo: null,
            subject: values.subject.trim(),
            body: values.message ?? "",
        });
        setDrafts([...(allDrafts ?? []), draft]);
    };

    const updateDraft = () => {
        const values = form.state.values;
        const draftIndex = allDrafts.findIndex((msg) => msg.id === id.current);

        if (!hasDraftContent(values)) {
            if (draftIndex !== -1 && id.current) {
                deleteDraftById(id.current);
            }
            return;
        }

        if (draftIndex === -1) {
            createDraft();
            return;
        }

        const nextDrafts = allDrafts.map((draft, index) =>
            index === draftIndex
                ? {
                      ...draft,
                      datetime: Date.now(),
                      to: values.to.account.trim(),
                      subject: values.subject.trim(),
                      body: values.message ?? "",
                  }
                : draft,
        );
        setDrafts(nextDrafts);
    };

    const validateComposeForm = async () => {
        const errors = await form.validate("submit");
        if (Object.keys(errors).length > 0) return false;

        const fieldErrors = await form.validateAllFields("submit");
        return fieldErrors.length === 0;
    };

    const onOpenChange = (nextOpen: boolean) => {
        setOpen(nextOpen);
        if (!nextOpen) {
            if (isSent.current) return;
            const values = form.state.values;
            updateDraft();
            if (hasDraftContent(values)) {
                toast.success("Your draft has been saved");
            }
            form.reset();
            return;
        }

        // the ID should be (re)set each time this opens; remember, it stays mounted
        isSent.current = false;
        if (message?.isDraft) {
            id.current = message.id;
        } else {
            id.current =
                window.crypto.randomUUID?.() ?? Math.random().toString();
        }
        populateFormFromMessage();
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            {trigger}
            <DialogContent
                className="flex h-[100dvh] max-h-[100dvh] max-w-full flex-col gap-0 overflow-hidden rounded-none p-0 sm:h-auto sm:max-h-[min(90dvh,720px)] sm:max-w-[600px] sm:rounded-lg"
                onCloseAutoFocus={(e) => {
                    // This helps in not focusing on the trigger after closing the modal
                    e.preventDefault();
                }}
            >
                <form.AppForm>
                    <form
                        onSubmit={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            void form.handleSubmit();
                        }}
                        className="flex min-h-0 flex-1 flex-col"
                    >
                        <DialogHeader className="shrink-0 px-4 pt-8 pr-12 sm:px-6 sm:pt-6">
                            <DialogTitle>
                                {message?.isDraft
                                    ? "Edit draft"
                                    : message
                                      ? "Reply"
                                      : "New message"}
                            </DialogTitle>
                            <DialogDescription>
                                Send a message to other accounts on chain. This
                                is for demo purposes only. All messages are
                                stored on chain unencrypted and are publicly
                                readable.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4 sm:px-6">
                            <FieldAccountExisting
                                form={form}
                                fields="to"
                                label="To"
                                description={undefined}
                                placeholder="Recipient account name"
                                disabled={false}
                                onValidate={() => {
                                    updateDraft();
                                }}
                            />
                            <form.AppField
                                name="subject"
                                listeners={{
                                    onChange: () => {
                                        updateDraft();
                                    },
                                }}
                                children={(field) => (
                                    <div className="flex shrink-0 flex-col gap-2">
                                        <Label htmlFor="compose-subject">
                                            Subject
                                        </Label>
                                        <Input
                                            id="compose-subject"
                                            placeholder="Subject"
                                            value={field.state.value}
                                            onBlur={field.handleBlur}
                                            onChange={(e) => {
                                                field.handleChange(
                                                    e.target.value,
                                                );
                                            }}
                                        />
                                        <FieldErrors meta={field.state.meta} />
                                    </div>
                                )}
                            />
                            <form.AppField
                                name="message"
                                listeners={{
                                    onChange: () => {
                                        updateDraft();
                                    },
                                }}
                                children={(field) => (
                                    <div className="flex min-h-0 flex-1 flex-col gap-2">
                                        <Label htmlFor="compose-message">
                                            Message
                                        </Label>
                                        <Textarea
                                            id="compose-message"
                                            placeholder="Write your message..."
                                            className="field-sizing-fixed min-h-[160px] flex-1 resize-none overflow-y-auto text-sm sm:min-h-[240px]"
                                            value={field.state.value}
                                            onBlur={field.handleBlur}
                                            onChange={(e) => {
                                                field.handleChange(
                                                    e.target.value,
                                                );
                                            }}
                                        />
                                        <FieldErrors meta={field.state.meta} />
                                    </div>
                                )}
                            />
                        </div>
                        <DialogFooter className="shrink-0 flex flex-col-reverse gap-2 border-t px-4 py-4 sm:flex-row sm:justify-between sm:space-x-2 sm:px-6 sm:pb-6">
                            <Button
                                variant="outline"
                                onClick={(e) => {
                                    e.preventDefault();
                                    onOpenChange(false);
                                }}
                                className="w-full sm:w-auto"
                                type="button"
                            >
                                <X className="mr-2 size-4" />
                                Cancel
                            </Button>
                            <AlertDialog>
                                <AlertDialogTrigger asChild>
                                    <SendTriggerButton
                                        onValidate={validateComposeForm}
                                    />
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
                                            onClick={() => {
                                                void form.handleSubmit();
                                            }}
                                        >
                                            Send
                                        </AlertDialogAction>
                                    </AlertDialogFooter>
                                </AlertDialogContent>
                            </AlertDialog>
                        </DialogFooter>
                    </form>
                </form.AppForm>
            </DialogContent>
        </Dialog>
    );
}

export default ComposeDialog;

interface SendTriggerButtonProps extends ButtonProps {
    onValidate: () => Promise<boolean>;
}

const SendTriggerButton = forwardRef<HTMLButtonElement, SendTriggerButtonProps>(
    ({ onValidate, onClick, ...props }, ref) => {
        const handleClick = async (e: React.MouseEvent<HTMLButtonElement>) => {
            const isValid = await onValidate();
            if (isValid) {
                onClick?.(e);
            }
        };

        return (
            <Button
                className="w-full sm:w-auto"
                {...props}
                ref={ref}
                onClick={handleClick}
            >
                <Send className="mr-2 size-4" />
                Send Message
            </Button>
        );
    },
);

SendTriggerButton.displayName = "SendTriggerButton";

export const ComposeDialogTrigger = ({
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
                        aria-label="Compose message"
                    >
                        <SquarePen className="size-5" />
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
            <Button variant="outline" size="sm" disabled={disabled}>
                <Reply className="mr-2 size-4" />
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
                    <Button
                        variant="ghost"
                        size="icon"
                        disabled={disabled}
                        aria-label="Edit and send draft"
                    >
                        <PencilIcon className="size-5" />
                    </Button>
                </DialogTrigger>
            </TooltipTrigger>
            <TooltipContent>Edit &amp; Send</TooltipContent>
        </Tooltip>
    );
};
