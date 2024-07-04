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
}

export const ChainTypeForm = ({ form }: Props) => (
    <Form {...form}>
        <form className="space-y-6">
            <FormField
                control={form.control}
                name="type"
                render={({ field }) => (
                    <FormItem>
                        <div className="flex w-full justify-between gap-8">
                            <Button
                                onClick={() => {
                                    field.onChange("dev");
                                }}
                                variant={
                                    field.value === "dev"
                                        ? "secondary"
                                        : "outline"
                                }
                                className={cn(
                                    "flex h-20 w-0 grow basis-0 flex-col gap-3",
                                    {
                                        "border-2 border-primary":
                                            field.value === "dev",
                                    }
                                )}
                            >
                                <div className="text-2xl">Dev</div>
                                <div className="w-full text-left text-sm text-muted-foreground">
                                    Dev description
                                </div>
                            </Button>
                            <Button
                                onClick={() => {
                                    field.onChange("prod");
                                }}
                                variant={
                                    field.value === "prod"
                                        ? "secondary"
                                        : "outline"
                                }
                                className={cn(
                                    "flex h-20 w-0 grow basis-0 flex-col gap-3",
                                    {
                                        "border-2 border-primary":
                                            field.value === "prod",
                                    }
                                )}
                            >
                                <div className="text-2xl">Prod</div>
                                <div className="w-full text-left text-sm text-muted-foreground">
                                    Prod description
                                </div>
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
