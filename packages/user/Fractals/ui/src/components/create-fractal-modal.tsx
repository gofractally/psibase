import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

import {
    useCreateFractal,
    zParams as zCreateFractalSchema,
} from "@/hooks/fractals/use-create-fractal";
import { useMemberships } from "@/hooks/fractals/use-memberships";
import { isAccountAvailable } from "@/hooks/use-account-status";
import { useCurrentUser } from "@/hooks/use-current-user";

import { useAppForm } from "@shared/components/form/app-form";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@shared/shadcn/ui/dialog";

export const CreateFractalModal = ({
    show,
    openChange,
}: {
    show: boolean;
    openChange: (show: boolean) => void;
}) => {
    const { mutateAsync: createFractal } = useCreateFractal();

    const { data: currentUser } = useCurrentUser();
    const { refetch } = useMemberships(currentUser);

    const navigate = useNavigate();

    const form = useAppForm({
        defaultValues: {
            fractalAccount: "",
            guildAccount: '',
            mission: "",
            name: "",
        },
        onSubmit: async (data) => {
            await createFractal(data.value);
            openChange(false);
            navigate(`/fractal/${data.value.fractalAccount}`);
            refetch();
        },
        validators: {
            onChange: zCreateFractalSchema,
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
                    <DialogTitle>Create a new fractal</DialogTitle>
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
                                <field.TextField label="Fractal name" />
                            )}
                        />
                        <form.AppField
                            name="mission"
                            children={(field) => (
                                <field.TextField label="Mission" />
                            )}
                        />
                        <form.AppField
                            name="fractalAccount"
                            validators={{
                                onChangeAsyncDebounceMs: 1000,
                                onChangeAsync: async ({ value }) => {
                                    const status =
                                        await isAccountAvailable(value);
                                    if (status === "Taken") {
                                        return "Account name is already taken";
                                    }
                                    if (status === "Invalid") {
                                        return "Invalid account name";
                                    }
                                    return undefined;
                                },
                            }}
                            children={(field) => (
                                <field.TextField
                                    label="Fractal account name"
                                    description="Unique identifier"
                                />
                            )}
                        />

                        <form.AppField
                            name="guildAccount"
                            validators={{
                                onChangeAsyncDebounceMs: 1000,
                                onChangeAsync: async ({ value }) => {
                                    const status =
                                        await isAccountAvailable(value);
                                    if (status === "Taken") {
                                        return "Account name is already taken";
                                    }
                                    if (status === "Invalid") {
                                        return "Invalid account name";
                                    }
                                    return undefined;
                                },
                            }}
                            children={(field) => (
                                <field.TextField
                                    label="Genesis guild account name"
                                    description="Unique identifier"
                                />
                            )}
                        />


                        <form.AppForm>
                            <form.SubmitButton
                                labels={[
                                    "Create fractal",
                                    "Creating fractal...",
                                    "Created fractal",
                                ]}
                            />
                        </form.AppForm>
                    </form>
                </DialogHeader>
            </DialogContent>
        </Dialog>
    );
};
