import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

import {
    useCreateGuild,
    zParams as zCreateGuild,
} from "@/hooks/fractals/use-create-guild";
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

        },
        onSubmit: async ({ value: { name, slug, } }) => {
            await createGuild({
                name,
                slug,
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
                                <field.TextField label="Name" />
                            )}
                        />
                        <form.AppField
                            name="slug"
                            validators={{
                                onChangeAsyncDebounceMs: 1000,
                                onChangeAsync: async ({ value }) => {
                                    const guild =
                                        await getGuildBySlug(fractalAccount, value);
                                    if (guild) {
                                        return "Slug is already in use";
                                    }
                                },
                            }}
                            children={(field) => (
                                <field.TextField
                                    label="Slug"
                                    description="Unique identifier inside the fractal"
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
