import { z } from "zod";

import { useFractal } from "@/hooks/fractals/use-fractal";
import { useSetRankedGuildSlots } from "@/hooks/fractals/use-set-ranked-guild-slots";

import { useAppForm } from "@shared/components/form/app-form";
import { zU8 } from "@shared/lib/schemas/u8";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@shared/shadcn/ui/dialog";

export const SetRankedGuildSlots = ({
    show,
    openChange,
}: {
    show: boolean;
    openChange: (show: boolean) => void;
}) => {
    const { mutateAsync: setRankedGuildSlots } = useSetRankedGuildSlots();

    const { data: fractal } = useFractal();
    const form = useAppForm({
        defaultValues: {
            slots: fractal?.fractal?.consensusReward?.rankedGuildSlotCount || 6,
        },
        onSubmit: async ({ formApi, value: { slots } }) => {
            await setRankedGuildSlots([slots]);
            openChange(false);
            formApi.reset({ slots });
        },
        validators: {
            onChange: z.object({
                slots: zU8,
            }),
        },
    });

    return (
        <Dialog open={show} onOpenChange={openChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Set ranked slots</DialogTitle>
                    <div className="text-muted-foreground text-sm">
                        <p>
                            Sets the number of ranked guild slots for reward
                            distribution.
                        </p>
                        <p>
                            Tokens sent to unoccupied slots are automatically
                            returned to the fractal stream. Reserving extra
                            slots now ensures new guilds can be ranked later
                            without disrupting existing allocations.
                        </p>
                    </div>
                    <form
                        onSubmit={(e) => {
                            e.preventDefault();
                            void form.handleSubmit();
                        }}
                        className="mt-3 w-full space-y-6"
                    >
                        <form.AppField
                            name="slots"
                            children={(field) => (
                                <field.NumberField label="Slots amount" />
                            )}
                        />

                        <form.AppForm>
                            <form.SubmitButton
                                labels={["Set slots", "Setting slots"]}
                            />
                        </form.AppForm>
                    </form>
                </DialogHeader>
            </DialogContent>
        </Dialog>
    );
};
