import { UseFormReturn } from "react-hook-form";
import { z } from "zod";

import { type BlockProducerSchema } from "@/pages/create-page";

import {
    Form,
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormMessage,
} from "../ui/form";
import { Input } from "../ui/input";

interface Props {
    form: UseFormReturn<z.infer<typeof BlockProducerSchema>>;
    next: () => Promise<void>;
}

export const BlockProducerForm = ({ form, next }: Props) => (
    <Form {...form}>
        <form className="space-y-6" onSubmit={form.handleSubmit(next)}>
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
