import { UseFormReturn } from "react-hook-form";
import { z } from "zod";

import { getErrorMessage } from "@/lib/utils";
import { KeyDeviceSchema } from "@/types";

import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@shared/shadcn/ui/form";
import { Input } from "@shared/shadcn/ui/input";
import { RadioGroup, RadioGroupItem } from "@shared/shadcn/ui/radio-group";

import { useKeyDevices, useUnlockKeyDevice } from "../../hooks/useKeyDevices";

interface Props {
    form: UseFormReturn<z.infer<typeof KeyDeviceSchema>>;
    next: () => Promise<void>;
    deviceNotFoundErrorMessage: string;
}

export const KeyDeviceForm = ({
    form,
    next,
    deviceNotFoundErrorMessage,
}: Props) => {
    const { data: keyDevices, isError, isSuccess } = useKeyDevices();
    const { mutateAsync: unlock } = useUnlockKeyDevice();

    const keyDeviceId = form.watch("id");
    const selectedDevice = keyDevices?.find((d) => d.id === keyDeviceId);

    const unlockDevice = async (pin?: string) => {
        try {
            await unlock({ device: keyDeviceId, pin });
            return true;
        } catch (e) {
            const message = getErrorMessage(e);
            if (message === "pin incorrect") return "Incorrect PIN";
            return message;
        }
    };

    const onSubmit = (e: React.SyntheticEvent) => {
        e.preventDefault();
        next();
    };

    return (
        <>
            {isSuccess && !keyDevices.length ? (
                <div className="mb-4 flex max-w-[450px] items-center gap-3">
                    <p className="text-2xl">⚠️</p>
                    <p>{deviceNotFoundErrorMessage}</p>
                </div>
            ) : null}
            {isError ? (
                <div className="mb-4 flex max-w-[450px] items-center gap-3">
                    <p className="text-2xl">⚠️</p>
                    <p>
                        There was an error fetching security devices. See the
                        console for more information.
                    </p>
                </div>
            ) : null}
            <Form {...form}>
                <form className="space-y-6" onSubmit={onSubmit}>
                    <FormField
                        control={form.control}
                        name="id"
                        rules={{
                            required: true,
                        }}
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel htmlFor="key-device">
                                    Security device
                                </FormLabel>
                                <FormControl>
                                    <RadioGroup
                                        onValueChange={field.onChange}
                                        defaultValue={field.value}
                                        id="key-device"
                                    >
                                        {keyDevices?.map((device) => (
                                            <FormItem
                                                className="flex items-center space-x-2"
                                                key={device.id}
                                            >
                                                <FormControl>
                                                    <RadioGroupItem
                                                        value={device.id}
                                                        id={device.id}
                                                    />
                                                </FormControl>
                                                <FormLabel htmlFor={device.id}>
                                                    {device.name || device.id}
                                                </FormLabel>
                                            </FormItem>
                                        ))}
                                    </RadioGroup>
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    {selectedDevice && !selectedDevice?.unlocked ? (
                        <FormField
                            control={form.control}
                            name="pin"
                            rules={{
                                validate: unlockDevice,
                            }}
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel htmlFor="pin">
                                        Device unlock PIN
                                    </FormLabel>
                                    <FormControl>
                                        <Input
                                            placeholder="Device PIN"
                                            id="pin"
                                            type="password"
                                            {...field}
                                        />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                    ) : null}
                </form>
            </Form>
        </>
    );
};
