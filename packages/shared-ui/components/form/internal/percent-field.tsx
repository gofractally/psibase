import { TextInput } from "@shared/components/form/internal/text-input";
import { cn } from "@shared/lib/utils";
import { Label } from "@shared/shadcn/ui/label";

import { useFieldContext } from "../app-form";
import { FieldErrors } from "./field-errors";

export const PercentField = ({
    label,
    description,
    disabled,
    placeholder,
}: {
    label: string;
    description?: string;
    disabled?: boolean;
    placeholder?: string;
}) => {
    const field = useFieldContext<string>();
    const isError = field.state.meta.errors.length > 0;
    const isTouched = field.state.meta.isTouched;

    return (
        <div className="flex flex-col gap-2">
            <Label className={cn(isError && isTouched && "text-destructive")}>
                {label}
            </Label>
            <TextInput
                inputMode="decimal"
                disabled={disabled}
                placeholder={placeholder}
                value={field.state.value}
                name={field.name}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
                aria-invalid={isError && isTouched}
                endContent={
                    <span className="text-muted-foreground pr-3 text-sm">%</span>
                }
            />
            {description && (
                <p className="text-muted-foreground text-sm">{description}</p>
            )}
            <FieldErrors meta={field.state.meta} />
        </div>
    );
};
