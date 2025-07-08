import { useNavigate } from "react-router-dom";

import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@shared/shadcn/ui/dialog";

import { useCreateFractal } from "@/hooks/fractals/use-create-fractal";
import { useMemberships } from "@/hooks/fractals/use-memberships";
import { useCurrentUser } from "@/hooks/use-current-user";

import { useAppForm } from "./form/app-form";

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
            account: "",
            mission: "",
            name: "",
        },
        validators: {
            onSubmitAsync: async (data) => {
                await createFractal(data.value);
                openChange(false);
                navigate(`/fractal/${data.value.account}`);
                refetch();
            },
        },
    });

    return (
        <Dialog open={show} onOpenChange={openChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Add a fractal</DialogTitle>
                    <form
                        onSubmit={(e) => {
                            e.preventDefault();
                            void form.handleSubmit();
                        }}
                        className="w-full space-y-6"
                    >
                        <form.AppField
                            name="account"
                            children={(field) => (
                                <field.TextField
                                    label="Username"
                                    description="Unique identifier"
                                />
                            )}
                        />
                        <form.AppField
                            name="name"
                            children={(field) => (
                                <field.TextField label="Name" />
                            )}
                        />
                        <form.AppField
                            name="mission"
                            children={(field) => (
                                <field.TextField label="Mission" />
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
