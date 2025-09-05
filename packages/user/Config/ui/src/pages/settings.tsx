import { useAppForm } from "@/components/forms/app-form";

import { useSetSnapshot } from "@/hooks/use-set-snapshot";
import { useSnapshotSeconds } from "@/hooks/use-snapshot-seconds";

import { Label } from "@shared/shadcn/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@shared/shadcn/ui/select";

const oneDay = 86400;

export const Settings = () => {
    const { mutateAsync: setSnapshot } = useSetSnapshot();

    const { data: seconds } = useSnapshotSeconds();
    const form = useAppForm({
        defaultValues: {
            seconds: seconds || oneDay,
        },
        onSubmit: async (data) => {
            await setSnapshot([data.value.seconds]);
            form.reset({
                seconds: data.value.seconds,
            });
        },
    });

    return (
        <div className="mx-auto w-full max-w-screen-lg space-y-6 px-2">
            <div>
                <h2 className="text-lg font-medium">Settings</h2>
                <p className="text-muted-foreground text-sm">
                    Settings apply network wide.
                </p>
            </div>

            <form
                onSubmit={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    form.handleSubmit();
                }}
                className="space-y-4"
            >
                <div className="rounded-lg  border p-4 ">
                    <div className="flex justify-between">
                        <div className="w-full space-y-0.5 pb-3">
                            <Label className="text-base">Snapshots</Label>
                            <div className="text-muted-foreground text-sm">
                                Network snapshot interval.{" "}
                            </div>
                        </div>
                        <div className="flex w-full justify-end">
                            <form.Field name="seconds">
                                {(field) => (
                                    <div className="flex gap-2">
                                        <Select
                                            onValueChange={(value) => {
                                                field.setValue(Number(value));
                                            }}
                                            value={field.state.value.toString()}
                                        >
                                            <SelectTrigger id="mode">
                                                <SelectValue placeholder="Select mode" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value={"0"}>
                                                    Never
                                                </SelectItem>
                                                <SelectItem
                                                    value={oneDay.toString()}
                                                >
                                                    1 day
                                                </SelectItem>
                                                <SelectItem
                                                    value={(
                                                        oneDay * 2
                                                    ).toString()}
                                                >
                                                    2 days
                                                </SelectItem>
                                                <SelectItem
                                                    value={(
                                                        oneDay * 7
                                                    ).toString()}
                                                >
                                                    1 week
                                                </SelectItem>
                                                <SelectItem
                                                    value={(
                                                        oneDay * 14
                                                    ).toString()}
                                                >
                                                    2 weeks
                                                </SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                )}
                            </form.Field>
                        </div>
                    </div>
                    <div className="mt-6 flex flex-row-reverse font-medium">
                        <form.AppForm>
                            <form.SubmitButton labels={["Save", "Saving..."]} />
                        </form.AppForm>
                    </div>
                </div>
            </form>
        </div>
    );
};
