import { z } from "zod";

import { useSetGuildBio } from "@/hooks/fractals/use-set-guild-bio";
import { useSetGuildDescription } from "@/hooks/fractals/use-set-guild-description";
import { useSetGuildDisplayName } from "@/hooks/fractals/use-set-guild-display-name";
import { useGuild } from "@/hooks/use-guild";
import { useGuildAccount } from "@/hooks/use-guild-account";

import { useAppForm } from "@shared/components/form/app-form";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@shared/shadcn/ui/dialog";

export const SetGuildMetadataModal = ({
    show,
    openChange,
}: {
    show: boolean;
    openChange: (show: boolean) => void;
}) => {
    const guildAccount = useGuildAccount();

    const { data: guild, refetch } = useGuild();

    const { mutateAsync: setGuildBio } = useSetGuildBio();
    const { mutateAsync: setGuildDescription } = useSetGuildDescription();
    const { mutateAsync: setGuildDisplayName } = useSetGuildDisplayName();

    const form = useAppForm({
        defaultValues: {
            displayName: guild?.displayName ?? "",
            bio: guild?.bio ?? "",
            description: guild?.description ?? "",
        },
        onSubmit: async ({
            value: { displayName, bio, description },
            formApi,
        }) => {
            try {
                const promises = [];

                if (!formApi.getFieldMeta("displayName")?.isDefaultValue) {
                    promises.push(
                        setGuildDisplayName([guildAccount!, displayName]),
                    );
                }
                if (!formApi.getFieldMeta("bio")?.isDefaultValue) {
                    promises.push(setGuildBio([guildAccount!, bio]));
                }
                if (!formApi.getFieldMeta("description")?.isDefaultValue) {
                    promises.push(
                        setGuildDescription([guildAccount!, description]),
                    );
                }

                await Promise.all(promises);
                openChange(false);
            } catch (e) {
                refetch();
                throw e;
            }
        },
        validators: {
            onChange: z.object({
                displayName: z.string().min(1),
                bio: z.string(),
                description: z.string(),
            }),
        },
    });

    return (
        <Dialog open={show} onOpenChange={openChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Update guild metadata</DialogTitle>
                    <form.AppForm>
                        <form
                            onSubmit={(e) => {
                                e.preventDefault();
                                void form.handleSubmit();
                            }}
                            className="mt-3 w-full space-y-6"
                        >
                            <form.AppField
                                name="displayName"
                                children={(field) => (
                                    <field.TextField label="Guild name" />
                                )}
                            />
                            <form.AppField
                                name="bio"
                                children={(field) => (
                                    <field.TextField label="Description" />
                                )}
                            />
                            <form.AppField
                                name="description"
                                children={(field) => (
                                    <field.TextField label="Mission" />
                                )}
                            />
                            <form.SubmitButton
                                labels={["Update", "Updating"]}
                            />
                        </form>
                    </form.AppForm>
                </DialogHeader>
            </DialogContent>
        </Dialog>
    );
};
