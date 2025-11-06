import { cn } from "@shared/lib/utils";
import { Input } from "@shared/shadcn/ui/input";
import { Label } from "@shared/shadcn/ui/label";

import { useFieldContext } from "../app-form";
import { FieldErrors } from "./field-errors";

export const NumberField = ({
    label,
    placeholder,
    description,
    required,
    disabled,
}: {
    label: string;
    placeholder?: string;
    description?: string;
    required?: boolean;
    disabled?: boolean;
}) => {
    const { state, handleBlur, handleChange, name } = useFieldContext<number>();

    const isError = state.meta.errors.length > 0;
    const isBlurred = state.meta.isBlurred;

    return (
        <div>
            <Label className={cn(isError && isBlurred && "text-destructive")}>
                {label}
            </Label>
            <Input
                type="number"
                name={name}
                required={required}
                value={state.value}
                placeholder={placeholder}
                onChange={(e) => handleChange(e.target.valueAsNumber)}
                onFocus={(e) => e.target.select()}
                onBlur={handleBlur}
                className={disabled ? "hide-number-input-arrows" : undefined}
                disabled={disabled}
            />
            {description && (
                <p className="text-muted-foreground text-sm">{description}</p>
            )}
            <FieldErrors meta={state.meta} />
        </div>
    );
};
