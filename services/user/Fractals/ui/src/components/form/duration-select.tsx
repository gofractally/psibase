import { useMemo, useState } from "react";
import { z } from "zod";

import { Input } from "@shared/shadcn/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@shared/shadcn/ui/select";

import { useFieldContext } from "./app-form";

const zDuration = z.enum(["Minutes", "Hours", "Days"]);

export const DurationSelect = ({
    label,
    defaultFrequency = "Minutes",
}: {
    label: string;
    defaultFrequency?: z.infer<typeof zDuration>;
}) => {
    const [unit, setUnit] =
        useState<z.infer<typeof zDuration>>(defaultFrequency);
    const field = useFieldContext();
    const seconds = field.state.value as number; // Assuming value is seconds, not Date

    // Convert seconds to the display value based on the unit
    const displayValue = useMemo(() => {
        if (typeof seconds !== "number" || isNaN(seconds)) return "";
        let value = seconds;
        if (unit === zDuration.Values.Hours) value = seconds / 3600;
        else if (unit === zDuration.Values.Days) value = seconds / 86400;
        else value = seconds / 60;
        return value.toString();
    }, [seconds, unit]);

    const handleValueChange = (input: string) => {
        const num = parseFloat(input);
        if (!isNaN(num)) {
            let newSeconds = num;
            if (unit === zDuration.Values.Hours) newSeconds = num * 3600;
            else if (unit === zDuration.Values.Days) newSeconds = num * 86400;
            else newSeconds = num * 60;
            field.handleChange(newSeconds);
        }
    };

    const handleUnitChange = (newUnit: z.infer<typeof zDuration>) => {
        setUnit(newUnit);
        const num = parseFloat(displayValue);
        if (!isNaN(num)) {
            let newSeconds = num;
            if (newUnit === zDuration.Values.Hours) newSeconds = num * 3600;
            else if (newUnit === zDuration.Values.Days)
                newSeconds = num * 86400;
            else newSeconds = num * 60;
            field.handleChange(newSeconds);
        }
    };

    return (
        <div className="flex w-full flex-col gap-1 py-2">
            <div>{label}</div>
            <div className="flex w-full gap-2">
                <Input
                    type="number"
                    value={displayValue}
                    onChange={(e) => handleValueChange(e.target.value)}
                    placeholder="Enter duration"
                    className="w-full"
                />
                <Select value={unit} onValueChange={handleUnitChange}>
                    <SelectTrigger className="w-32">
                        <SelectValue
                            className="w-32"
                            placeholder="Select unit"
                        />
                    </SelectTrigger>
                    <SelectContent>
                        {zDuration.options.map((option) => (
                            <SelectItem key={option} value={option}>
                                {option}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>
        </div>
    );
};
