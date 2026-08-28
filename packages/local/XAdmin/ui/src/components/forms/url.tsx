import { zodResolver } from "@hookform/resolvers/zod";
import { Unplug } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Button } from "@shared/shadcn/ui/button";
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormMessage,
    FormRootError,
} from "@shared/shadcn/ui/form";
import { Input } from "@shared/shadcn/ui/input";

const FormSchema = z.object({
    url: z.string().url(),
});

export type Schema = z.infer<typeof FormSchema>;

const defaultValues = {
    url: "",
};

interface Props {
    onSubmit: (data: Schema) => void | Promise<void>;
    existingValues?: Schema | undefined;
}

export function UrlForm({ onSubmit: handleSubmit, existingValues }: Props) {
    const form = useForm<z.infer<typeof FormSchema>>({
        resolver: zodResolver(FormSchema),
        defaultValues: existingValues || defaultValues,
    });

    const onSubmit = async (values: Schema) => {
        try {
            await handleSubmit(values);
        } catch (e) {
            const message = "Unrecognised error";
            if (e instanceof Error) {
                form.setError("root", { message: e.message });
            } else if (typeof e == "string") {
                form.setError("root", { message: e });
            } else {
                form.setError("root", { message });
            }
        }
    };

    return (
        <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                <FormField
                    control={form.control}
                    name="url"
                    render={({ field }) => (
                        <FormItem>
                            <FormControl>
                                <Input placeholder="URL" {...field} />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />
                <div className="flex w-full items-center justify-between gap-3">
                    <FormRootError />
                    <Button
                        type="submit"
                        disabled={form.formState.isSubmitting}
                    >
                        <Unplug />
                        {form.formState.isSubmitting
                            ? "Connecting..."
                            : "Connect"}
                    </Button>
                </div>
            </form>
        </Form>
    );
}
