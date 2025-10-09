import { cn } from "@shared/lib/utils";
import { Checkbox } from "@shared/shadcn/ui/checkbox";
import { Label } from "@shared/shadcn/ui/label";

import { useFieldContext } from "./app-form";
import { FieldErrors } from "./field-errors";

export const CheckboxField = ({
    label,
    description,
    required,
    disabled,
}: {
    label: string;
    description?: string;
    required?: boolean;
    disabled?: boolean;
}) => {
    const { state, handleChange } = useFieldContext<boolean>();

    const isError = state.meta.errors.length > 0;
    const isBlurred = state.meta.isBlurred;

    return (
        <div>
            <div className="flex w-full">
                <Label
                    className={cn(isError && isBlurred && "text-destructive")}
                >
                    {label}
                </Label>
                <Checkbox
                    disabled={disabled}
                    required={required}
                    checked={state.value}
                    onCheckedChange={(checked) => handleChange(!!checked)}
                />
            </div>
            {description && (
                <p className="text-muted-foreground text-sm">{description}</p>
            )}
            <FieldErrors meta={state.meta} />
        </div>
    );
};
