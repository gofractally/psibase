import {
    FlaskConical,
    Key,
    Landmark,
    Lock,
    ShieldCheck,
    type LucideIcon,
} from "lucide-react";
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
}

type Spec = {
    icon: LucideIcon;
    label: string;
    value: string;
};

const specRows = [
    {
        icon: Lock,
        label: "Security",
        dev: "Keyless accounts",
        prod: "Key-based accounts",
    },
    {
        icon: Landmark,
        label: "Governance",
        dev: "None",
        prod: "Fractal network",
    },
    {
        icon: Key,
        label: "Producer keys",
        dev: "Not required",
        prod: "Security device",
    },
] as const;

const specsFor = (mode: "dev" | "prod"): Spec[] =>
    specRows.map((row) => ({
        icon: row.icon,
        label: row.label,
        value: row[mode],
    }));

const TemplateCard = ({
    icon: Icon,
    title,
    subtitle,
    specs,
    selected,
    disabled,
    onSelect,
    footer,
}: {
    icon: typeof FlaskConical;
    title: string;
    subtitle: string;
    specs: Spec[];
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
            "bg-card group focus-visible:ring-ring flex h-full min-h-0 flex-1 basis-0 cursor-pointer flex-col items-start rounded-xl border p-6 text-left shadow-sm transition-[color,background-color,border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-primary/50 hover:bg-accent hover:shadow-md focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 disabled:hover:border-border disabled:hover:bg-card disabled:hover:shadow-sm",
            selected && "border-primary border-2",
        )}
    >
        <div className="flex w-full items-start justify-between gap-3">
            <div className="space-y-1">
                <h2 className="text-lg font-medium">{title}</h2>
                <p className="text-muted-foreground text-sm">{subtitle}</p>
            </div>
            <div className="bg-muted flex size-10 shrink-0 items-center justify-center rounded-lg transition-colors group-hover:bg-background">
                <Icon className="size-5" />
            </div>
        </div>
        <dl className="mt-6 w-full flex-1 divide-y">
            {specs.map(({ icon: SpecIcon, label, value }) => (
                <div
                    key={label}
                    className="flex items-start gap-2.5 py-3 first:pt-0 last:pb-0"
                >
                    <SpecIcon className="text-muted-foreground mt-0.5 size-3.5 shrink-0" />
                    <div>
                        <dt className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                            {label}
                        </dt>
                        <dd className="mt-0.5 text-sm">{value}</dd>
                    </div>
                </div>
            ))}
        </dl>
        {footer}
    </button>
);

export const ChainTypeForm = ({ form, next }: Props) => {
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
                                    subtitle="For local testing"
                                    specs={specsFor("dev")}
                                    selected={field.value === "dev"}
                                    onSelect={() => {
                                        field.onChange("dev");
                                        void next();
                                    }}
                                />
                                <TemplateCard
                                    icon={ShieldCheck}
                                    title="Production"
                                    subtitle="For a live network"
                                    specs={specsFor("prod")}
                                    selected={field.value === "prod"}
                                    disabled={!window.isSecureContext}
                                    onSelect={() => {
                                        field.onChange("prod");
                                        void next();
                                    }}
                                    footer={
                                        !window.isSecureContext ? (
                                            <p className="text-muted-foreground pt-3 text-sm">
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
