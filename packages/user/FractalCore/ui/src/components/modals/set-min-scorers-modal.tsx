import { z } from "zod";

import { useFractal } from "@/hooks/fractals/use-fractal";
import { useSetMinScorers } from "@/hooks/fractals/use-set-min-scorers";
import { MIN_MINIMUM_REQUIRED_SCORERS } from "@/lib/constants";

import { useAppForm } from "@shared/components/form/app-form";
import { zU8 } from "@shared/lib/schemas/u8";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@shared/shadcn/ui/dialog";

export const SetMinScorersModal = ({
    show,
    openChange,
}: {
    show: boolean;
    openChange: (show: boolean) => void;
}) => {
    const { mutateAsync: setMinScorers } = useSetMinScorers();

    const { data: fractal } = useFractal();
    const form = useAppForm({
        defaultValues: {
            minScorers: fractal?.fractal?.minimumRequiredScorers ?? 4,
        },
        onSubmit: async ({ formApi, value: { minScorers } }) => {
            await setMinScorers([minScorers]);
            formApi.reset({ minScorers });
            openChange(false);
        },
        validators: {
            onChange: z.object({
                minScorers: zU8.min(MIN_MINIMUM_REQUIRED_SCORERS),
            }),
        },
    });

    return (
        <Dialog open={show} onOpenChange={openChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Set minimum scorers</DialogTitle>
                    <div className="text-muted-foreground text-sm">
                        Set the minimum amount of fractal members must achieve a
                        non zero score before the fractal token is achieved.
                    </div>
                    <form
                        onSubmit={(e) => {
                            e.preventDefault();
                            void form.handleSubmit();
                        }}
                        className="mt-3 w-full space-y-6"
                    >
                        <form.AppField
                            name="minScorers"
                            children={(field) => (
                                <field.NumberField label="Minimum scorers" />
                            )}
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
