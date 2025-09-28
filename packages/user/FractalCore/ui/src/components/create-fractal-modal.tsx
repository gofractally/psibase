import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

import {
    useCreateGuild,
    zParams as zCreateGuild,
} from "@/hooks/fractals/use-create-fractal";
import { useMemberships } from "@/hooks/fractals/use-memberships";
import { useCurrentUser } from "@/hooks/use-current-user";

import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@shared/shadcn/ui/dialog";

import { useAppForm } from "./form/app-form";
import { useFractalAccount } from "@/hooks/fractals/use-fractal-account";
import { getGuildBySlug } from "@/lib/graphql/fractals/getGuildBySlug";


export const CreateGuildModal = ({
    show,
    openChange,
}: {
    show: boolean;
    openChange: (show: boolean) => void;
}) => {
    const { mutateAsync: createGuild } = useCreateGuild();
    const fractalAccount = useFractalAccount();

    const { data: currentUser } = useCurrentUser();
    const { refetch } = useMemberships(currentUser);


    const navigate = useNavigate();

    const form = useAppForm({
        defaultValues: {
            slug: "",
            name: "",
            bio: "",
        },
        onSubmit: async ({ value: { name, slug, bio } }) => {
            await createGuild({
                name,
                slug,
                bio,
                description: ""
            });
            openChange(false);
            navigate(`/guild/${slug}`);
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
                                <field.TextField label="Guild name" />
                            )}
                        />
                        <form.AppField
                            name="bio"
                            children={(field) => (
                                <field.TextField label="Bio" />
                            )}
                        />
                        <form.AppField
                            name="slug"
                            validators={{
                                onChangeAsyncDebounceMs: 1000,
                                onChangeAsync: async ({ value }) => {
                                    const guild =
                                        await getGuildBySlug(fractalAccount, value);
                                    console.log({ guild })
                                    if (guild) {
                                        return "Slug is already taken";
                                    }
                                },
                            }}
                            children={(field) => (
                                <field.TextField
                                    label="Slug"
                                    description="Unique identifier in Fractal"
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
