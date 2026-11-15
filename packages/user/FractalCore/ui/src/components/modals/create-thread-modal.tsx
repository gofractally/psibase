import { z } from "zod";

import { useGuildMembershipsOfUser } from "@/hooks/fractals/use-guild-memberships";
import { usePluginFunctionCallMutation } from "@/hooks/use-plugin-function-call-mutation";
import { social } from "@/lib/social";

import { useAppForm } from "@shared/components/form/app-form";
import { useCurrentUser } from "@shared/hooks/use-current-user";
import { zAccount } from "@shared/lib/schemas/account";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@shared/shadcn/ui/dialog";

const zCreateThread = z.object({
    guild: zAccount,
    account: zAccount,
    title: z
        .string()
        .refine((title) => title.trim().length > 0, "Title is required")
        .refine(
            (title) => new TextEncoder().encode(title).length <= 80,
            "Title must be 80 bytes or less",
        ),
});

export const CreateThreadModal = ({
    show,
    openChange,
    onCreated,
}: {
    show: boolean;
    openChange: (show: boolean) => void;
    onCreated: (account: string) => void;
}) => {
    const { data: currentUser } = useCurrentUser();
    const { data: memberships } = useGuildMembershipsOfUser(currentUser);
    const guilds = memberships ?? [];

    const createThread = usePluginFunctionCallMutation(social.createThread, {
        toast: {
            error: "Thread failed",
            loading: "Creating thread",
            success: "Thread created",
        },
    });

    const form = useAppForm({
        defaultValues: {
            guild: "",
            account: "",
            title: "",
        },
        validators: {
            onChange: zCreateThread,
        },
        onSubmit: async ({ formApi, value }) => {
            await createThread.mutateAsync([
                value.guild,
                value.account,
                value.title,
                false,
            ]);
            openChange(false);
            formApi.reset();
            onCreated(value.account);
        },
    });

    return (
        <Dialog open={show} onOpenChange={openChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>New thread</DialogTitle>
                    <form
                        onSubmit={(event) => {
                            event.preventDefault();
                            void form.handleSubmit();
                        }}
                        className="mt-3 w-full space-y-6"
                    >
                        <form.AppField
                            name="guild"
                            children={(field) => (
                                <field.SelectField
                                    label="Guild"
                                    placeholder={
                                        guilds.length === 0
                                            ? "You are not in a guild"
                                            : "Select a guild"
                                    }
                                    disabled={guilds.length === 0}
                                    options={guilds.map((membership) => ({
                                        value: membership.guild.account,
                                        label: membership.guild.displayName,
                                    }))}
                                />
                            )}
                        />
                        <form.AppField
                            name="account"
                            children={(field) => (
                                <field.TextField
                                    label="Thread"
                                    placeholder="cats"
                                />
                            )}
                        />
                        <form.AppField
                            name="title"
                            children={(field) => (
                                <field.TextField label="Title" />
                            )}
                        />
                        <form.AppForm>
                            <form.SubmitButton
                                labels={["Create thread", "Creating..."]}
                                disabled={guilds.length === 0}
                            />
                        </form.AppForm>
                    </form>
                </DialogHeader>
            </DialogContent>
        </Dialog>
    );
};
