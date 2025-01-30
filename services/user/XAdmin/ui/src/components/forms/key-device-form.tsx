import { UseFormReturn } from "react-hook-form";
import { z } from "zod";

import { KeyDeviceSchema } from "@/pages/create-page";
import { getErrorMessage } from "@/lib/utils";

import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "../ui/form";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "../ui/card";
import { Input } from "../ui/input";
import { RadioGroup, RadioGroupItem } from "../ui/radio-group";

import { useKeyDevices, useUnlockKeyDevice } from "../../hooks/useKeyDevices";

interface Props {
    form: UseFormReturn<z.infer<typeof KeyDeviceSchema>>;
    next: () => Promise<void>;
}

export const KeyDeviceForm = ({ form, next }: Props) => {
    const { data: keyDevices } = useKeyDevices();
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

    return (
        <Card className="min-w-[350px]">
            <CardHeader>
                <CardTitle>Select key device</CardTitle>
                <CardDescription>
                    Where do you want your block producer server key and signing
                    key to be stored?
                </CardDescription>
            </CardHeader>
            <CardContent>
                <Form {...form}>
                    <form
                        className="space-y-6"
                        onSubmit={form.handleSubmit(next)}
                    >
                        <FormField
                            control={form.control}
                            name="id"
                            rules={{
                                required: true,
                            }}
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel htmlFor="key-device">
                                        Key device
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
                                                    <FormLabel
                                                        htmlFor={device.id}
                                                    >
                                                        {device.name ||
                                                            device.id}
                                                    </FormLabel>
                                                </FormItem>
                                            ))}
                                        </RadioGroup>
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        {selectedDevice && !selectedDevice.unlocked ? (
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
            </CardContent>
        </Card>
    );
};
