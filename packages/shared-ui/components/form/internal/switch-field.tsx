import { cn } from "@shared/lib/utils";
import { Label } from "@shared/shadcn/ui/label";

import { FieldErrors } from "./field-errors";
import { useFieldContext } from "../app-form";
import { Switch } from "@shared/shadcn/ui/switch";

export const SwitchField = ({
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
            <div className="flex w-full justify-between">
                <Label
                    className={cn(isError && isBlurred && "text-destructive")}
                >
                    {label}
                </Label>
                <Switch disabled={disabled} required={required} checked={state.value} onCheckedChange={(e) => {
                    handleChange(e)
                }} />
            </div>
            {description && (
                <p className="text-muted-foreground text-sm">{description}</p>
            )}
            <FieldErrors meta={state.meta} />
        </div>
    );
};
