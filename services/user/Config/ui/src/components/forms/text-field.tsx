import type { InputHTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/utils";

import { Input } from "@shared/shadcn/ui/input";
import { Label } from "@shared/shadcn/ui/label";
import { Skeleton } from "@shared/shadcn/ui/skeleton";

import { useFieldContext } from "./app-form";
import { FieldErrors } from "./field-errors";

export const TextField = ({
    label,
    placeholder,
    description,
    rightLabel,
    isLoading = false,
    type = "text",
    required,
    disabled,
}: {
    label?: string;
    isLoading?: boolean;
    rightLabel?: ReactNode;
    placeholder?: string;
    type?: InputHTMLAttributes<HTMLInputElement>["type"];
    description?: string;
    required?: boolean;
    disabled?: boolean;
}) => {
    const field = useFieldContext<string>();

    const isError = field.state.meta.errors.length > 0;
    const isBlurred = field.state.meta.isBlurred;

    return (
        <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
                <Label
                    className={cn(isError && isBlurred && "text-destructive")}
                >
                    {label}
                </Label>
                {rightLabel && rightLabel}
            </div>

            {isLoading ? (
                <Skeleton className="h-10 w-full rounded-sm" />
            ) : (
                <Input
                    value={field.state.value}
                    name={field.name}
                    required={required}
                    placeholder={placeholder}
                    onChange={(e) => {
                        field.handleChange(e.target.value);
                    }}
                    onBlur={field.handleBlur}
                    type={type}
                    disabled={disabled}
                />
            )}

            {description && (
                <p className="text-muted-foreground text-sm">{description}</p>
            )}
            <FieldErrors meta={field.state.meta} />
        </div>
    );
};
