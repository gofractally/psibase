import { Trigger } from "@radix-ui/react-select";

import { cn } from "@shared/lib/utils";
import { Label } from "@shared/shadcn/ui/label";
import {
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    Select as ShadcnSelect,
} from "@shared/shadcn/ui/select";

import { useFieldContext } from "../app-form";
import { FieldErrors } from "./field-errors";

export interface SelectOption<T = string> {
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
    TriggerComponent?: React.ReactNode;
    OptionComponent?: ({
        option,
    }: {
        option: SelectOption<T>;
    }) => React.ReactNode;
    keyExtractor?: (option: SelectOption<T>) => string;
}

export const SelectField = <T = string,>({
    options,
    label,
    placeholder = "Select an option",
    disabled = false,
    className,
    TriggerComponent,
    OptionComponent,
    keyExtractor = (option: SelectOption<T>) => String(option.value),
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
                        typeof keyExtractor(options[0]) === "number"
                            ? (Number(value) as T)
                            : (value as T);
                    field.handleChange(convertedValue);
                }}
                disabled={disabled}
            >
                {TriggerComponent ? (
                    <Trigger
                        data-slot="select-trigger"
                        className="focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive flex w-fit rounded-md outline-none transition-[color,box-shadow] focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {TriggerComponent}
                    </Trigger>
                ) : (
                    <SelectTrigger className={className} id={field.name}>
                        <SelectValue placeholder={placeholder} />
                    </SelectTrigger>
                )}
                <SelectContent>
                    {options.map((option) => (
                        <SelectItem
                            key={keyExtractor(option)}
                            value={keyExtractor(option)}
                            disabled={option.disabled}
                        >
                            {OptionComponent?.({ option }) ?? option.label}
                        </SelectItem>
                    ))}
                </SelectContent>
            </ShadcnSelect>
            <FieldErrors meta={field.state.meta} />
        </div>
    );
};

export default SelectField;
