import { cn } from "@shared/lib/utils";
import { Label } from "@shared/shadcn/ui/label";
import {
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    Select as ShadcnSelect,
} from "@shared/shadcn/ui/select";

import { useFieldContext } from "./app-form";
import { FieldErrors } from "./field-errors";

interface SelectOption<T = string> {
    value: T;
    label: string;
    disabled?: boolean;
}

interface Props<T = string> {
    options: SelectOption<T>[];
    label?: string;
    placeholder?: string;
    disabled?: boolean;
    className?: string;
}

export const SelectField = <T extends string | number = string>({
    options,
    label,
    placeholder = "Select an option",
    disabled = false,
    className,
}: Props<T>) => {
    const field = useFieldContext<T>();

    const isError = field.state.meta.errors.length > 0;
    const isBlurred = field.state.meta.isBlurred;

    return (
        <div className="flex flex-col gap-2">
            {label && (
                <Label
                    className={cn(isError && isBlurred && "text-destructive")}
                >
                    {label}
                </Label>
            )}
            <ShadcnSelect
                value={field.state.value?.toString()}
                onValueChange={(value) => {
                    // Convert back to the original type
                    const convertedValue =
                        typeof options[0]?.value === "number"
                            ? (Number(value) as T)
                            : (value as T);
                    field.handleChange(convertedValue);
                }}
                disabled={disabled}
            >
                <SelectTrigger className={className} id={field.name}>
                    <SelectValue placeholder={placeholder} />
                </SelectTrigger>
                <SelectContent>
                    {options.map((option) => (
                        <SelectItem
                            key={option.value.toString()}
                            value={option.value.toString()}
                            disabled={option.disabled}
                        >
                            {option.label}
                        </SelectItem>
                    ))}
                </SelectContent>
            </ShadcnSelect>
            <FieldErrors meta={field.state.meta} />
        </div>
    );
};

export default SelectField;
