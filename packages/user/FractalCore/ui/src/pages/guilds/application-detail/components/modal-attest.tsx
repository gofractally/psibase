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

export const ModalAttest = ({
    show,
    openChange,
    endorses = false,
}: {
    show: boolean;
    openChange: (show: boolean) => void;
    endorses: boolean;
}) => {
    const { mutateAsync: attest } = useAttestMembershipApp();

    const guildAccount = useGuildAccount();

    const { applicant } = useParams();

    const form = useAppForm({
        defaultValues: {
            comment: "",
        },
        onSubmit: async ({ formApi, value: { comment } }) => {
            await attest([guildAccount!, applicant!, comment, endorses]);
            openChange(false);
            formApi.reset();
        },
        validators: {
            onChange: z.object({
                comment: z.string(),
            }),
        },
    });

    return (
        <Dialog open={show} onOpenChange={openChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>
                        {endorses ? "Endorse" : "Object to"} applicant
                    </DialogTitle>
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

                        <form.AppForm>
                            <form.SubmitButton
                                labels={
                                    endorses
                                        ? ["Endorse", "Endorsing"]
                                        : ["Object", "Objecting"]
                                }
                            />
                        </form.AppForm>
                    </form>
                </DialogHeader>
            </DialogContent>
        </Dialog>
    );
};
