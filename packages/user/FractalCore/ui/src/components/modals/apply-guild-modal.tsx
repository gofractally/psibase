import { useNavigate } from "react-router-dom";
import { z } from "zod";

import { useApplyGuild } from "@/hooks/fractals/use-apply-guild";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useGuildAccount } from "@/hooks/use-guild-account";

import { useAppForm } from "@shared/components/form/app-form";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@shared/shadcn/ui/dialog";

export const ApplyGuildModal = ({
    show,
    openChange,
}: {
    show: boolean;
    openChange: (show: boolean) => void;
}) => {
    const { mutateAsync: applyGuild } = useApplyGuild();

    const { data: currentUser } = useCurrentUser();

    const guildAccount = useGuildAccount();
    const navigate = useNavigate();

    const form = useAppForm({
        defaultValues: {
            extraInfo: "",
        },
        onSubmit: async ({ formApi, value: { extraInfo } }) => {
            await applyGuild([guildAccount!, extraInfo]);
            openChange(false);
            formApi.reset();
            navigate(`/guild/${guildAccount}/applications/${currentUser}`);
        },
        validators: {
            onChange: z.object({
                extraInfo: z.string(),
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
                            name="extraInfo"
                            children={(field) => (
                                <field.TextField label="Extra info" />
                            )}
                        />

                        <form.AppForm>
                            <form.SubmitButton labels={["Apply", "Applying"]} />
                        </form.AppForm>
                    </form>
                </DialogHeader>
            </DialogContent>
        </Dialog>
    );
};
