import { Trigger } from "@radix-ui/react-select";

import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@shared/shadcn/ui/select";

export interface SelectOption<T = string> {
    value: T;
    label: string;
    disabled?: boolean;
}

interface Props<T = string> {
    options: SelectOption<T>[];
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
    value?: string;
    onChange?: (value: string) => void;
}

export const CustomSelect = <T = string,>({
    options,
    placeholder = "Select an option",
    disabled = false,
    className,
    TriggerComponent,
    OptionComponent,
    keyExtractor = (option: SelectOption<T>) => String(option.value),
    value,
    onChange,
}: Props<T>) => {
    return (
        <Select
            value={value}
            onValueChange={(value) => {
                // Convert back to the original type
                const convertedValue =
                    typeof keyExtractor(options[0]) === "number"
                        ? (Number(value) as T)
                        : (value as T);
                console.log("convertedValue:", convertedValue);
                onChange?.(convertedValue as string);
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
                <SelectTrigger className={className}>
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
        </Select>
    );
};

export default CustomSelect;
