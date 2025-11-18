import type { ReactNode } from "react";

import { TextInput } from "@shared/components/form/internal/text-input";
import { cn } from "@shared/lib/utils";
import { Label } from "@shared/shadcn/ui/label";

import { useFieldContext } from "../app-form";
import { FieldErrors } from "./field-errors";

export const TextField = ({
    label,
    placeholder,
    description,
    rightLabel,
    required,
    disabled,
    startContent,
    endContent,
}: {
    label?: string;
    rightLabel?: ReactNode;
    placeholder?: string;
    description?: string;
    required?: boolean;
    disabled?: boolean;
    startContent?: React.ReactNode;
    endContent?: React.ReactNode;
}) => {
    const field = useFieldContext<string>();

    const isError = field.state.meta.errors.length > 0;
    // const isBlurred = field.state.meta.isBlurred;
    const isTouched = field.state.meta.isTouched;

    return (
        <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
                <Label
                    className={cn(isError && isTouched && "text-destructive")}
                >
                    {label}
                </Label>
                {rightLabel && rightLabel}
            </div>
            <TextInput
                startContent={startContent}
                endContent={endContent}
                value={field.state.value}
                name={field.name}
                required={required}
                placeholder={placeholder}
                onChange={(e) => {
                    field.handleChange(e.target.value);
                }}
                onBlur={field.handleBlur}
                disabled={disabled}
                aria-invalid={isError && isTouched}
            />
            {description && (
                <p className="text-muted-foreground text-sm">{description}</p>
            )}
            <FieldErrors meta={field.state.meta} />
        </div>
    );
};
