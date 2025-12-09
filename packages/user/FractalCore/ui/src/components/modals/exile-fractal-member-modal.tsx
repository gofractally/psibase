import { useEffect } from "react";
import { z } from "zod";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@shared/shadcn/ui/dialog";
import { useAppForm } from "../form/app-form";
import { useExile } from "@/hooks/fractals/use-exile";

export const ExileFractalMemberModal = ({
    show,
    openChange,
}: {
    show: boolean;
    openChange: (show: boolean) => void;
}) => {
    const { mutateAsync: exileMember } = useExile();

    const form = useAppForm({
        defaultValues: {
            member: "",
        },
        onSubmit: async ({ value: { member } }) => {
            await exileMember([member]);
            openChange(false);
        },
        validators: {
            onChange: z.object({
                member: z.string(),
            }),
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
                    <DialogTitle>Exile guild member</DialogTitle>
                    <form
                        onSubmit={(e) => {
                            e.preventDefault();
                            void form.handleSubmit();
                        }}
                        className="mt-3 w-full space-y-6"
                    >
                        <form.AppField
                            name="member"
                            children={(field) => (
                                <field.TextField label="Member" />
                            )}
                        />

                        <form.AppForm>
                            <form.SubmitButton
                                labels={["Exile", "Exiling", "Exhiled"]}
                            />
                        </form.AppForm>
                    </form>
                </DialogHeader>
            </DialogContent>
        </Dialog>
    );
};
