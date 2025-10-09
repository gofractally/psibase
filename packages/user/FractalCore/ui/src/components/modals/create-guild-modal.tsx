import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

import {
    useCreateGuild,
    zParams as zCreateGuild,
} from "@/hooks/fractals/use-create-guild";
import { useGuildMembershipsOfUser } from "@/hooks/fractals/use-guild-memberships";
import { useCurrentUser } from "@/hooks/use-current-user";
import { isAccountAvailable } from "@/lib/isAccountAvailable";

import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@shared/shadcn/ui/dialog";

import { useAppForm } from "../form/app-form";

export const CreateGuildModal = ({
    show,
    openChange,
}: {
    show: boolean;
    openChange: (show: boolean) => void;
}) => {
    const { mutateAsync: createGuild } = useCreateGuild();

    const { data: currentUser } = useCurrentUser();
    const { refetch } = useGuildMembershipsOfUser(currentUser);

    const navigate = useNavigate();

    const form = useAppForm({
        defaultValues: {
            account: "",
            name: "",
        },
        onSubmit: async ({ value: { name, account } }) => {
            await createGuild({
                name,
                account,
            });
            openChange(false);
            navigate(`/guild/${account}`);
            refetch();
        },
        validators: {
            onChange: zCreateGuild,
        },
    });

    useEffect(() => {
        if (show && form.state.isSubmitSuccessful) {
            form.reset();
        }
    }, [form, show]);

    return (
        <Dialog open={show} onOpenChange={openChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Create a guild</DialogTitle>
                    <form
                        onSubmit={(e) => {
                            e.preventDefault();
                            void form.handleSubmit();
                        }}
                        className="mt-3 w-full space-y-6"
                    >
                        <form.AppField
                            name="name"
                            children={(field) => (
                                <field.TextField label="Name" />
                            )}
                        />
                        <form.AppField
                            name="account"
                            validators={{
                                onChangeAsyncDebounceMs: 1000,
                                onChangeAsync: async ({ value }) => {
                                    const accountStatus =
                                        await isAccountAvailable(value);
                                    if (accountStatus == "Taken") {
                                        return "Account is taken";
                                    } else if (accountStatus == "Invalid") {
                                        return "Invalid account";
                                    }
                                },
                            }}
                            children={(field) => (
                                <field.TextField
                                    label="Account"
                                    description="Unique identifier of the guild"
                                />
                            )}
                        />

                        <form.AppForm>
                            <form.SubmitButton
                                labels={[
                                    "Create Guild",
                                    "Creating Guild...",
                                    "Created Guild",
                                ]}
                            />
                        </form.AppForm>
                    </form>
                </DialogHeader>
            </DialogContent>
        </Dialog>
    );
};
