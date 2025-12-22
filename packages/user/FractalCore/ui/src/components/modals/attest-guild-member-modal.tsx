import { useParams } from "react-router-dom";
import { z } from "zod";

import { useAttestMembershipApp } from "@/hooks/fractals/use-attest-membership-app";
import { useGuildAccount } from "@/hooks/use-guild-account";

import { useAppForm } from "@shared/components/form/app-form";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@shared/shadcn/ui/dialog";

export const AttestGuildMemberModal = ({
    show,
    openChange,
}: {
    show: boolean;
    openChange: (show: boolean) => void;
}) => {
    const { mutateAsync: attest } = useAttestMembershipApp();

    const guildAccount = useGuildAccount();

    const { applicant } = useParams();

    const form = useAppForm({
        defaultValues: {
            comment: "",
            endorses: true,
        },
        onSubmit: async ({ formApi, value: { comment, endorses } }) => {
            await attest([guildAccount!, applicant!, comment, endorses]);
            openChange(false);
            formApi.reset();
        },
        validators: {
            onChange: z.object({
                comment: z.string(),
                endorses: z.boolean(),
            }),
        },
    });

    return (
        <Dialog open={show} onOpenChange={openChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Apply for Guild Membership</DialogTitle>
                    <form
                        onSubmit={(e) => {
                            e.preventDefault();
                            void form.handleSubmit();
                        }}
                        className="mt-3 w-full space-y-6"
                    >
                        <form.AppField
                            name="comment"
                            children={(field) => (
                                <field.TextField label="Comment" />
                            )}
                        />
                        <form.AppField
                            name="endorses"
                            children={(field) => (
                                <field.CheckboxField label="Endorse" />
                            )}
                        />

                        <form.AppForm>
                            <form.SubmitButton
                                labels={["Attest", "Attesting"]}
                            />
                        </form.AppForm>
                    </form>
                </DialogHeader>
            </DialogContent>
        </Dialog>
    );
};
