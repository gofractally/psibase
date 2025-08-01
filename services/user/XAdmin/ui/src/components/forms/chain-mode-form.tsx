import { UseFormReturn } from "react-hook-form";
import { z } from "zod";

import { cn } from "@shared/lib/utils";
import { Button } from "@shared/shadcn/ui/button";
import { Form, FormField, FormItem, FormMessage } from "@shared/shadcn/ui/form";

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

export const ChainTypeForm = ({ form, next }: Props) => {
    return (
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
                                            "border-primary border-2":
                                                field.value === "dev",
                                        },
                                    )}
                                >
                                    <h2 className="text-2xl">Development</h2>
                                    <p className="text-muted-foreground text-center text-sm">
                                        Boot chain with development apps,
                                        pre-built users and insecure
                                        authentication
                                    </p>
                                </Button>
                                <div className="flex flex-1 has-[:disabled]:cursor-not-allowed">
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
                                            "h-auto w-0 flex-1 select-none flex-col gap-1.5 whitespace-normal",
                                            {
                                                "border-primary border-2":
                                                    field.value === "prod",
                                            },
                                        )}
                                        disabled={!window.isSecureContext}
                                    >
                                        <h2 className="text-2xl">Production</h2>
                                        <p className="text-muted-foreground text-center text-sm">
                                            Create a secure production
                                            blockchain
                                        </p>
                                        {!window.isSecureContext ? (
                                            <p className="text-muted-foreground text-center text-sm">
                                                ⚠️ Only available via HTTPS or
                                                localhost
                                            </p>
                                        ) : null}
                                    </Button>
                                </div>
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
};
