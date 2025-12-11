import { useEffect } from "react";
import { z } from "zod";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@shared/shadcn/ui/dialog";
import { useAppForm } from '@shared/components/form/app-form'
import { FieldAccountExisting } from '@shared/components/form/field-account-existing'

import { useExile } from "@/hooks/fractals/use-exile";
import { zAccount } from "@/lib/zod/Account";
import { supervisor } from "@/supervisor";
import { useFractalAccount } from "@/hooks/fractals/use-fractal-account";

export const ExileFractalMemberModal = ({
    show,
    openChange,
}: {
    show: boolean;
    openChange: (show: boolean) => void;
}) => {
    const { mutateAsync: exileMember } = useExile();

    const fractalAccount = useFractalAccount();

    const form = useAppForm({
        defaultValues: {
            exile: {
                member: ""
            },
        },
        onSubmit: async ({ value: { exile: { member } } }) => {
            await exileMember([fractalAccount, member]);
            openChange(false);
        },
        validators: {
            onChange: z.object({
                exile: z.object({
                    member: zAccount,
                })
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
                        <FieldAccountExisting
                            form={form}
                            fields={{ account: 'exile.member' }}
                            label="Recipient Account"
                            description={undefined}
                            placeholder="Enter account name"
                            disabled={false}
                            supervisor={supervisor}
                        />

                        <form.AppForm>
                            <form.SubmitButton
                                labels={["Exile", "Exiling"]}
                            />
                        </form.AppForm>
                    </form>
                </DialogHeader>
            </DialogContent>
        </Dialog>
    );
};