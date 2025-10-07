import { useEffect } from "react";
import { useNavigate } from "react-router-dom";


import { useCurrentUser } from "@/hooks/use-current-user";

import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@shared/shadcn/ui/dialog";

import { useAppForm } from "../form/app-form";
import { useApplyGuild } from "@/hooks/fractals/use-apply-guild";
import { useGuildAccount } from "@/hooks/use-guild-id";
import { z } from "zod";


export const ApplyGuildModal = ({
    show,
    openChange,
}: {
    show: boolean;
    openChange: (show: boolean) => void;
}) => {
    const { mutateAsync: applyGuild } = useApplyGuild();

    const { data: currentUser } = useCurrentUser();

    const guildSlug = useGuildAccount();
    const navigate = useNavigate();

    const form = useAppForm({
        defaultValues: {
            app: "",
        },
        onSubmit: async ({ value: { app } }) => {
            await applyGuild({
                app,
                guildSlug: guildSlug!
            });
            openChange(false);
            navigate(`/guild/${guildSlug}/applications/${currentUser}`);
        },
        validators: {
            onChange: z.object({
                app: z.string()
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
                            name="app"
                            children={(field) => (
                                <field.TextField label="App" />
                            )}
                        />


                        <form.AppForm>
                            <form.SubmitButton
                                labels={[
                                    "Apply",
                                    "Applying",
                                    "Applied!",
                                ]}
                            />
                        </form.AppForm>
                    </form>
                </DialogHeader>
            </DialogContent>
        </Dialog>
    );
};
