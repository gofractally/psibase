import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Button } from "@shared/shadcn/ui/button";
import {
    Form,
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@shared/shadcn/ui/form";
import { Input } from "@shared/shadcn/ui/input";

const formSchema = z.object({
    displayName: z
        .string()
        .min(2, "Display name must be at least 2 characters")
        .max(50, "Display name must be less than 50 characters"),
    bio: z.string().max(160, "Bio must be less than 160 characters"),
});

type ProfileFormValues = z.infer<typeof formSchema>;

export const FormProfile = ({
    onSubmit,
    initialData = { displayName: "", bio: "" },
}: {
    onSubmit: (data: ProfileFormValues) => Promise<ProfileFormValues>;
    initialData?: ProfileFormValues;
}) => {
    const form = useForm<ProfileFormValues>({
        resolver: zodResolver(formSchema),
        defaultValues: initialData,
    });

    const handleSubmit = async (values: ProfileFormValues) => {
        try {
            const response = await onSubmit(values);
            form.reset(response);
        } catch (e) {
            console.error("Failed to update profile:", e);
            form.setError("root", {
                message:
                    e instanceof Error
                        ? e.message
                        : "An unknown error occurred",
            });
        }
    };

    return (
        <Form {...form}>
            <form
                onSubmit={form.handleSubmit(handleSubmit)}
                className="space-y-6"
            >
                {form.formState.errors.root && (
                    <p className="text-sm text-destructive">
                        {form.formState.errors.root.message}
                    </p>
                )}

                <FormField
                    control={form.control}
                    name="displayName"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Display Name</FormLabel>
                            <FormControl>
                                <Input
                                    placeholder="Your display name"
                                    {...field}
                                />
                            </FormControl>
                            <FormDescription>
                                This is the name that will be displayed to other
                                users.
                            </FormDescription>
                            <FormMessage />
                        </FormItem>
                    )}
                />

                <FormField
                    control={form.control}
                    name="bio"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Bio</FormLabel>
                            <FormControl>
                                <Input
                                    placeholder="Tell us about yourself"
                                    {...field}
                                />
                            </FormControl>
                            <FormDescription>
                                Share a brief description about yourself.
                            </FormDescription>
                            <FormMessage />
                        </FormItem>
                    )}
                />

                <Button
                    type="submit"
                    disabled={
                        form.formState.isSubmitting || !form.formState.isDirty
                    }
                >
                    {form.formState.isSubmitting ? "Saving..." : "Save Profile"}
                </Button>
            </form>
        </Form>
    );
};
