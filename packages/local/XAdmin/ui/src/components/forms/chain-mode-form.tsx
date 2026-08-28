import { Check, FlaskConical, ShieldCheck } from "lucide-react";
import { type ReactNode } from "react";
import { UseFormReturn } from "react-hook-form";
import { z } from "zod";

import { cn } from "@shared/lib/utils";
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
    devTemplateDescription: string;
    prodTemplateDescription: string;
}

const devHighlights = [
    "Keyless accounts (insecure AuthAny)",
    "Identity app included",
    "No security device required",
];

const prodHighlights = [
    "Key-based account authentication",
    "Fractal network governance",
    "Producer keys on a security device",
];

const TemplateCard = ({
    icon: Icon,
    title,
    description,
    highlights,
    selected,
    disabled,
    onSelect,
    footer,
}: {
    icon: typeof FlaskConical;
    title: string;
    description: string;
    highlights: string[];
    selected: boolean;
    disabled?: boolean;
    onSelect: () => void;
    footer?: ReactNode;
}) => (
    <button
        type="button"
        disabled={disabled}
        onClick={onSelect}
        className={cn(
            "bg-card hover:bg-accent/40 focus-visible:ring-ring flex h-full min-h-0 flex-1 basis-0 flex-col items-start gap-4 rounded-xl border p-6 text-left shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-60",
            selected && "border-primary border-2",
        )}
    >
        <div className="bg-muted flex size-10 items-center justify-center rounded-lg">
            <Icon className="size-5" />
        </div>
        <div className="space-y-1">
            <h2 className="text-lg font-medium">{title}</h2>
            <p className="text-muted-foreground text-sm leading-relaxed">
                {description}
            </p>
        </div>
        <ul className="mt-auto space-y-2">
            {highlights.map((item) => (
                <li key={item} className="flex items-start gap-2 text-sm">
                    <Check className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                    <span>{item}</span>
                </li>
            ))}
        </ul>
        {footer}
    </button>
);

export const ChainTypeForm = ({
    form,
    next,
    devTemplateDescription,
    prodTemplateDescription,
}: Props) => {
    return (
        <Form {...form}>
            <form className="space-y-6">
                <FormField
                    control={form.control}
                    name="type"
                    render={({ field }) => (
                        <FormItem>
                            <div className="flex w-full flex-col gap-4 sm:flex-row sm:gap-6">
                                <TemplateCard
                                    icon={FlaskConical}
                                    title="Development"
                                    description={devTemplateDescription}
                                    highlights={devHighlights}
                                    selected={field.value === "dev"}
                                    onSelect={() => {
                                        field.onChange("dev");
                                        void next();
                                    }}
                                />
                                <TemplateCard
                                    icon={ShieldCheck}
                                    title="Production"
                                    description={prodTemplateDescription}
                                    highlights={prodHighlights}
                                    selected={field.value === "prod"}
                                    disabled={!window.isSecureContext}
                                    onSelect={() => {
                                        field.onChange("prod");
                                        void next();
                                    }}
                                    footer={
                                        !window.isSecureContext ? (
                                            <p className="text-muted-foreground text-sm">
                                                Only available via HTTPS or
                                                localhost
                                            </p>
                                        ) : null
                                    }
                                />
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
