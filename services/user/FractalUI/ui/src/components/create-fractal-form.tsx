import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import {
    Form,
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";

import { Account } from "@/lib/zodTypes";

const FormSchema = z.object({
    fractalName: Account,
});

type FormSchemaType = z.infer<typeof FormSchema>;

interface Props {
    onSubmit: (data: FormSchemaType) => Promise<FormSchemaType>;
}

export const CreateFractalForm = ({ onSubmit }: Props) => {
    const form = useForm<z.infer<typeof FormSchema>>({
        resolver: zodResolver(FormSchema),
        defaultValues: {
            fractalName: "",
        },
    });

    const submit = async (data: FormSchemaType) => {
        await onSubmit(data);
    };

    return (
        <Form {...form}>
            <form
                onSubmit={form.handleSubmit(submit)}
                className="w-full space-y-6"
            >
                <FormField
                    control={form.control}
                    name="fractalName"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Fractal account name</FormLabel>
                            <FormControl>
                                <Input {...field} />
                            </FormControl>
                            <FormDescription>
                                This is your fractal's unique identifier.
                            </FormDescription>
                            <FormMessage />
                        </FormItem>
                    )}
                />
                <Button disabled={form.formState.isSubmitting} type="submit">
                    {form.formState.isSubmitting ? "Submitting" : "Submit"}
                </Button>
            </form>
        </Form>
    );
};
