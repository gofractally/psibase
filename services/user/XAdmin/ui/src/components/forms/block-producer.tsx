"use client";
import { UseFormReturn } from "react-hook-form";
import { z } from "zod";
import {
    Form,
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormMessage,
} from "../ui/form";
import { Input } from "../ui/input";

const BlockProducerSchema = z.object({
    name: z.string().min(2),
});

interface Props {
    form: UseFormReturn<z.infer<typeof BlockProducerSchema>>;
}

export const BlockProducerForm = ({ form }: Props) => (
    <Form {...form}>
        <form className="space-y-6">
            <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                    <FormItem>
                        <FormControl>
                            <Input
                                placeholder="Block producer name"
                                {...field}
                            />
                        </FormControl>
                        <FormDescription>
                            Must be a valid psibase account name.
                        </FormDescription>
                        <FormMessage />
                    </FormItem>
                )}
            />
        </form>
    </Form>
);
