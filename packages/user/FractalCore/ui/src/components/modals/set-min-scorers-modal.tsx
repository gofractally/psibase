import { z } from "zod";

import { useFractal } from "@/hooks/fractals/use-fractal";
import { useSetTokenThreshold } from "@/hooks/fractals/use-set-min-scorers";
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
    const { mutateAsync: setTokenThreshold } = useSetTokenThreshold();

    const { data: fractal } = useFractal();
    const form = useAppForm({
        defaultValues: {
            tokenThreshold: fractal?.fractal?.tokenInitThreshold ?? 4,
        },
        onSubmit: async ({ formApi, value: { tokenThreshold } }) => {
            await setTokenThreshold([tokenThreshold]);
            formApi.reset({ tokenThreshold });
            openChange(false);
        },
        validators: {
            onChange: z.object({
                tokenThreshold: zU8.min(MIN_MINIMUM_REQUIRED_SCORERS),
            }),
        },
    });

    return (
        <Dialog open={show} onOpenChange={openChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Set minimum scorers</DialogTitle>
                    <div className="text-muted-foreground text-sm">
                        Set the minimum number of active guild members of the legislation
                        before the fractal token is pushed into circulation.
                    </div>
                    <form
                        onSubmit={(e) => {
                            e.preventDefault();
                            void form.handleSubmit();
                        }}
                        className="mt-3 w-full space-y-6"
                    >
                        <form.AppField
                            name="tokenThreshold"
                            children={(field) => (
                                <field.NumberField label="Minimum active members" />
                            )}
                        />

                        <form.AppForm>
                            <form.SubmitButton
                                labels={["Set threshold", "Setting threshold"]}
                            />
                        </form.AppForm>
                    </form>
                </DialogHeader>
            </DialogContent>
        </Dialog>
    );
};
