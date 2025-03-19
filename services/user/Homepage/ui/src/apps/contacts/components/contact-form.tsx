import { Button } from "@/components/ui/button";
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { LocalContact } from "../types";

interface Props {
    initialValues?: z.infer<typeof LocalContact>;
    onSubmit: (data: z.infer<typeof LocalContact>) => Promise<void>;
}

const toastError = (error: unknown): void => {
    if (error instanceof Error) {
        toast.error(error.message);
    } else if (typeof error === "string") {
        toast.error(error);
    } else {
        console.error("Unknown error", error);
        toast.error("An unknown error occurred");
    }
};

export function ContactForm({ initialValues, onSubmit }: Props) {
    const form = useForm<z.infer<typeof LocalContact>>({
        resolver: zodResolver(LocalContact),
        defaultValues: initialValues,
    });

    const handleSubmit = async (data: z.infer<typeof LocalContact>) => {
        let id = toast.loading("Creating contact...");
        try {
            await onSubmit(data);
            toast.success(
                `Saved contact ${data.nickname || `@${data.account}`}`,
            );
        } catch (e) {
            toastError(e);
        }
        toast.dismiss(id);
    };

    return (
        <Form {...form}>
            <form
                onSubmit={form.handleSubmit(handleSubmit)}
                className="space-y-4 py-4"
            >
                <FormField
                    control={form.control}
                    name="account"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Account</FormLabel>
                            <FormControl>
                                <Input
                                    disabled={!!initialValues}
                                    placeholder="Account name"
                                    {...field}
                                />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />

                <FormField
                    control={form.control}
                    name="nickname"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Nickname</FormLabel>
                            <FormControl>
                                <Input placeholder="Johnny" {...field} />
                            </FormControl>

                            <FormMessage />
                        </FormItem>
                    )}
                />

                <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Email</FormLabel>
                            <FormControl>
                                <Input
                                    type="email"
                                    placeholder="john.doe@example.com"
                                    {...field}
                                />
                            </FormControl>

                            <FormMessage />
                        </FormItem>
                    )}
                />

                <FormField
                    control={form.control}
                    name="phone"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Phone</FormLabel>
                            <FormControl>
                                <Input
                                    placeholder="+1 (555) 123-4567"
                                    {...field}
                                />
                            </FormControl>

                            <FormMessage />
                        </FormItem>
                    )}
                />

                <Button type="submit" disabled={form.formState.isSubmitting}>
                    {form.formState.isSubmitting
                        ? "Submitting..."
                        : form.formState.isSubmitSuccessful
                          ? "Success"
                          : "Submit"}
                </Button>
            </form>
        </Form>
    );
}
