import { z } from "zod";


import { useAppForm } from "./form/app-form";
import { zAccount } from "@/lib/zod/Account";

const FormSchema = z.object({
    account: zAccount,
    name: z.string(),
    mission: z.string(),
});

type FormSchemaType = z.infer<typeof FormSchema>;

interface Props {
    onSubmit: (data: FormSchemaType) => Promise<FormSchemaType>;
}

export const CreateFractalForm = ({ onSubmit }: Props) => {
    const form = useAppForm({
        defaultValues: {
            account: "",
            mission: "",
            name: "",
        },
        validators: {
            onSubmitAsync: async (data) => {
                await onSubmit(data.value)
            },
        },
    });



    return (
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
                        label="Account name"
                        description="Unique identifier"
                    />
                )}
            />
            <form.AppField
                name="name"
                children={(field) => (
                    <field.TextField
                        label="Name"
                        description="Display name"
                    />
                )}
            />
            <form.AppField
                name="mission"
                children={(field) => (
                    <field.TextField
                        label="Mission"

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
    );
};
