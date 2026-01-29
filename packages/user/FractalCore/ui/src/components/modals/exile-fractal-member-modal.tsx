import { z } from "zod";

import { useExile } from "@/hooks/fractals/use-exile";

import { useAppForm } from "@shared/components/form/app-form";
import { FieldAccountExisting } from "@shared/components/form/field-account-existing";
import { zAccount } from "@shared/lib/schemas/account";
import { supervisor } from "@shared/lib/supervisor";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@shared/shadcn/ui/dialog";

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
            exile: {
                member: "",
            },
        },
        onSubmit: async ({
            formApi,
            value: {
                exile: { member },
            },
        }) => {
            await exileMember([member]);
            openChange(false);
            formApi.reset();
        },
        validators: {
            onChange: z.object({
                exile: z.object({
                    member: zAccount,
                }),
            }),
        },
    });

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
                            fields={{ account: "exile.member" }}
                            label="Recipient Account"
                            description={undefined}
                            placeholder="Enter account name"
                            disabled={false}
                            supervisor={supervisor}
                        />

                        <form.AppForm>
                            <form.SubmitButton labels={["Exile", "Exiling"]} />
                        </form.AppForm>
                    </form>
                </DialogHeader>
            </DialogContent>
        </Dialog>
    );
};
