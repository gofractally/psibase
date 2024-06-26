"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormMessage,
    FormRootError,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Unplug } from "lucide-react";

const FormSchema = z.object({
    url: z.string().url(),
});

type Schema = z.infer<typeof FormSchema>;

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
            let message = "Unrecognised error";
            if (e instanceof Error) {
                form.setError("root", { message: e.message });
            } else if (typeof e == "string") {
                form.setError("root", { message: e });
            } else {
                console.warn("Unrecognised error of", e);
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
                <div className="flex w-full justify-between">
                    <div>
                        <FormRootError />
                    </div>
                    <Button
                        className="w-40"
                        size="lg"
                        type="submit"
                        disabled={form.formState.isSubmitting}
                    >
                        <Unplug size={20} className="absolute mr-28" />
                        <div>
                            {form.formState.isSubmitting
                                ? "Connecting.."
                                : "Connect"}
                        </div>
                    </Button>
                </div>
            </form>
        </Form>
    );
}
