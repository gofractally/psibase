"use client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { UseFormReturn } from "react-hook-form";
import { z } from "zod";
import { Form, FormField, FormItem, FormMessage } from "../ui/form";

export const chainTypeSchema = z.object({
    type: z.enum(["dev", "prod"], {
        required_error: "You need to select a type.",
    }),
});

type ChainTypeShape = z.infer<typeof chainTypeSchema>;

interface Props {
    form: UseFormReturn<ChainTypeShape>;
    next: () => Promise<void>;
}

export const ChainTypeForm = ({ form, next }: Props) => (
    <Form {...form}>
        <form className="space-y-6">
            <FormField
                control={form.control}
                name="type"
                render={({ field }) => (
                    <FormItem>
                        <div className="flex w-full justify-between gap-8">
                            <Button
                                onClick={(event) => {
                                    event.preventDefault();
                                    field.onChange("dev");
                                    next();
                                }}
                                variant={
                                    field.value === "dev"
                                        ? "secondary"
                                        : "outline"
                                }
                                className={cn(
                                    "h-auto w-0 flex-1 select-none flex-col gap-1.5 whitespace-normal disabled:cursor-not-allowed",
                                    {
                                        "border-2 border-primary":
                                            field.value === "dev",
                                    }
                                )}
                            >
                                <h2 className="text-2xl">Development</h2>
                                <p className="text-center text-sm text-muted-foreground">
                                    Boot chain with development apps, pre-built
                                    users and insecure authentication.
                                </p>
                            </Button>
                            <Button
                                onClick={(event) => {
                                    event.preventDefault();
                                    field.onChange("prod");
                                    next();
                                }}
                                variant={
                                    field.value === "prod"
                                        ? "secondary"
                                        : "outline"
                                }
                                className={cn(
                                    "h-auto w-0 flex-1 select-none flex-col gap-1.5 whitespace-normal disabled:cursor-not-allowed",
                                    {
                                        "border-2 border-primary":
                                            field.value === "prod",
                                    }
                                )}
                                disabled
                            >
                                <h2 className="text-2xl">Production</h2>
                                <p className="text-center text-sm text-muted-foreground">
                                    Create a secure production blockchain.
                                </p>
                            </Button>
                        </div>
                        <div className="flex justify-center">
                            <FormMessage />
                        </div>
                    </FormItem>
                )}
            />
        </form>
    </Form>
);
