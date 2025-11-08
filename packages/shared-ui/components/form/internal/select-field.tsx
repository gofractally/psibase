import type { SelectOption } from "@shared/shadcn/custom/select";

import { cn } from "@shared/lib/utils";
import { CustomSelect } from "@shared/shadcn/custom/select";
import { Label } from "@shared/shadcn/ui/label";

import { useFieldContext } from "../app-form";
import { FieldErrors } from "./field-errors";

export type { SelectOption };

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
    placeholder,
    disabled,
    className,
    TriggerComponent,
    OptionComponent,
    keyExtractor,
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
            <CustomSelect<T>
                options={options}
                keyExtractor={keyExtractor}
                TriggerComponent={TriggerComponent}
                OptionComponent={OptionComponent}
                value={field.state.value?.toString()}
                onChange={(value) => {
                    field.handleChange(value as T);
                }}
                disabled={disabled}
                className={className}
                placeholder={placeholder}
            />
            <FieldErrors meta={field.state.meta} />
        </div>
    );
};

export default SelectField;
