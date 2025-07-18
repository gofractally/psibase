import { zodResolver } from "@hookform/resolvers/zod";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { z } from "zod";

import { Button } from "@shared/shadcn/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@shared/shadcn/ui/dialog";
import { Input } from "@shared/shadcn/ui/input";
import { Label } from "@shared/shadcn/ui/label";

const formSchema = z.object({
    individualPolicies: z
        .array(
            z.object({
                path: z.string().min(1, "Path is required"),
                csp: z.string(),
            }),
        )
        .refine(
            (policies) => {
                const globalPolicies = policies.filter((p) => p.path === "*");
                return globalPolicies.length <= 1;
            },
            {
                message: "Only one global policy (with '*' path) is allowed",
            },
        ),
});

export const CspForm = ({
    onSubmit,
    initialData,
}: {
    onSubmit: (
        data: z.infer<typeof formSchema>,
    ) => Promise<z.infer<typeof formSchema>>;
    initialData: z.infer<typeof formSchema>;
}) => {
    const [isOpen, setIsOpen] = useState(false);

    const form = useForm<z.infer<typeof formSchema>>({
        resolver: zodResolver(formSchema),
        defaultValues: initialData,
    });

    const { fields, append, remove } = useFieldArray({
        control: form.control,
        name: "individualPolicies",
    });

    const handleAddPath = () => {
        append({ csp: "", path: "" });
    };

    const handleAddGlobal = () => {
        append({ csp: "", path: "*" });
    };

    const submit = async (values: z.infer<typeof formSchema>) => {
        try {
            const response = await onSubmit(values);
            form.reset(response);
            setIsOpen(false);
        } catch (e) {
            console.error("Failed to submit CSP form:", e);
            form.setError("root", {
                message:
                    e instanceof Error
                        ? e.message
                        : "An unknown error occurred",
            });
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <div className="flex flex-row items-center justify-between rounded-lg border p-4">
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Content Security Headers</DialogTitle>
                        <DialogDescription>
                            <p className="my-3">
                                Define your application's Content Security
                                Policy (CSP) settings. The global CSP applies by
                                default, but specific paths with their own CSP
                                will take precedence.
                            </p>
                            {form.formState.errors.root && (
                                <p className="text-destructive mb-3 text-sm">
                                    {form.formState.errors.root.message}
                                </p>
                            )}
                            {form.formState.errors.individualPolicies && (
                                <p className="text-destructive mb-3 text-sm">
                                    {
                                        form.formState.errors.individualPolicies
                                            .message
                                    }
                                </p>
                            )}
                            <form
                                onSubmit={form.handleSubmit(submit)}
                                className="space-y-4"
                            >
                                <div className="flex flex-col gap-2">
                                    {fields.map((field, index) => (
                                        <div
                                            key={field.id}
                                            className="flex items-center space-x-2"
                                        >
                                            {field.path === "*" ? (
                                                <div className="flex min-w-[100px] items-center">
                                                    <span className="text-sm font-medium">
                                                        Global (*)
                                                    </span>
                                                </div>
                                            ) : (
                                                <Input
                                                    placeholder="Path"
                                                    {...form.register(
                                                        `individualPolicies.${index}.path`,
                                                    )}
                                                />
                                            )}
                                            <Input
                                                placeholder="CSP"
                                                {...form.register(
                                                    `individualPolicies.${index}.csp`,
                                                )}
                                            />
                                            <Button
                                                variant="destructive"
                                                size="icon"
                                                className="flex items-center justify-center p-2"
                                                type="button"
                                                onClick={() => remove(index)}
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    ))}
                                </div>
                                <div className="flex justify-between">
                                    <div className="space-x-2">
                                        <Button
                                            variant="outline"
                                            type="button"
                                            onClick={handleAddPath}
                                        >
                                            Add Path
                                        </Button>
                                        <Button
                                            variant="outline"
                                            type="button"
                                            onClick={handleAddGlobal}
                                            disabled={fields.some(
                                                (field) => field.path === "*",
                                            )}
                                        >
                                            Add Global Path
                                        </Button>
                                    </div>
                                    <Button
                                        type="submit"
                                        disabled={form.formState.isSubmitting}
                                    >
                                        Save
                                    </Button>
                                </div>
                            </form>
                        </DialogDescription>
                    </DialogHeader>
                </DialogContent>
                <div className="space-y-0.5">
                    <Label className="text-base">Content Security Policy</Label>
                </div>
                <DialogTrigger asChild>
                    <Button variant="outline" onClick={() => setIsOpen(true)}>
                        Edit
                    </Button>
                </DialogTrigger>
            </div>
        </Dialog>
    );
};
