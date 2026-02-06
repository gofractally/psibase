import { z } from "zod";

import { useSetGuildRep } from "@/hooks/fractals/use-set-guild-rep";
import { useGuildAccount } from "@/hooks/use-guild-account";

import { useAppForm } from "@shared/components/form/app-form";
import { FieldAccountExisting } from "@shared/components/form/field-account-existing";
import { supervisor } from "@shared/lib/supervisor";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@shared/shadcn/ui/dialog";

export const SetGuildRepModal = ({
    show,
    openChange,
}: {
    show: boolean;
    openChange: (show: boolean) => void;
}) => {
    const { mutateAsync: setGuildRep } = useSetGuildRep();
    const guildAccount = useGuildAccount();

    const form = useAppForm({
        defaultValues: {
            representation: {
                newRep: "",
            },
        },
        onSubmit: async ({
            formApi,
            value: {
                representation: { newRep },
            },
        }) => {
            await setGuildRep([guildAccount!, newRep]);
            openChange(false);
            formApi.reset({ representation: { newRep } });
        },
        validators: {
            onChange: z.object({
                representation: z.object({
                    newRep: z.string(),
                }),
            }),
        },
    });

    return (
        <Dialog open={show} onOpenChange={openChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Set guild representative</DialogTitle>
                    <form
                        onSubmit={(e) => {
                            e.preventDefault();
                            void form.handleSubmit();
                        }}
                        className="mt-3 w-full space-y-6"
                    >
                        <FieldAccountExisting
                            form={form}
                            fields={{ account: "representation.newRep" }}
                            label="New representative"
                            description={undefined}
                            placeholder="Enter account name"
                            disabled={false}
                            supervisor={supervisor}
                        />

                        <form.AppForm>
                            <form.SubmitButton
                                labels={["Set rep", "Setting rep"]}
                            />
                        </form.AppForm>
                    </form>
                </DialogHeader>
            </DialogContent>
        </Dialog>
    );
};
