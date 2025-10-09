import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { z } from "zod";

import { useAttestMembershipApp } from "@/hooks/fractals/use-attest-membership-app";
import { useGuildAccount } from "@/hooks/use-guild-id";

import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@shared/shadcn/ui/dialog";

import { useAppForm } from "../form/app-form";

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
        onSubmit: async ({ value: { comment, endorses } }) => {
            await attest({
                guildAccount: guildAccount!,
                comment,
                endorses,
                member: applicant!,
            });
            openChange(false);
        },
        validators: {
            onChange: z.object({
                comment: z.string(),
                endorses: z.boolean(),
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
                                labels={["Attest", "Attesting", "Attested"]}
                            />
                        </form.AppForm>
                    </form>
                </DialogHeader>
            </DialogContent>
        </Dialog>
    );
};
