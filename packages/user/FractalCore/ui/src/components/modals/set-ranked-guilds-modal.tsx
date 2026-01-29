import { z } from "zod";

import { useFractal } from "@/hooks/fractals/use-fractal";
import { useSetRankedGuilds } from "@/hooks/fractals/use-set-ranked-guilds";

import { useAppForm } from "@shared/components/form/app-form";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@shared/shadcn/ui/dialog";

export const SetRankedGuilds = ({
    show,
    openChange,
}: {
    show: boolean;
    openChange: (show: boolean) => void;
}) => {
    const { mutateAsync: setRankedGuilds } = useSetRankedGuilds();

    const { data: fractal } = useFractal();
    const form = useAppForm({
        defaultValues: {
            rankedGuilds: (
                fractal?.fractal?.consensusReward?.rankedGuilds ?? []
            ).join(","),
        },
        onSubmit: async ({ formApi, value: { rankedGuilds } }) => {
            await setRankedGuilds([rankedGuilds.split(",")]);
            openChange(false);
            formApi.reset({ rankedGuilds });
        },
        validators: {
            onChange: z.object({
                rankedGuilds: z.string(),
            }),
        },
    });

    return (
        <Dialog open={show} onOpenChange={openChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Set ranked guilds</DialogTitle>
                    <div className="text-muted-foreground text-sm">
                        <p>
                            Rank guilds putting the highest rewarded at the
                            front.
                        </p>
                        <p>Current limit is</p>
                    </div>
                    <form
                        onSubmit={(e) => {
                            e.preventDefault();
                            void form.handleSubmit();
                        }}
                        className="mt-3 w-full space-y-6"
                    >
                        <form.AppField
                            name="rankedGuilds"
                            children={(field) => (
                                <field.TextField label="Ranked guild accounts separated by comma" />
                            )}
                        />

                        <form.AppForm>
                            <form.SubmitButton
                                labels={[
                                    "Set ranked guilds",
                                    "Setting ranked guilds",
                                ]}
                            />
                        </form.AppForm>
                    </form>
                </DialogHeader>
            </DialogContent>
        </Dialog>
    );
};
