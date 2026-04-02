import { useMemo, useState } from "react";

import { Input } from "@shared/shadcn/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@shared/shadcn/ui/select";

import { zDurationUnit, type DurationUnit } from "@shared/lib/schemas/duration-unit";

import { useFieldContext } from "../app-form";

export const DurationSelect = ({ label }: { label: string }) => {
    const [unit, setUnit] = useState<DurationUnit>(
        zDurationUnit.enum.Minutes,
    );
    const field = useFieldContext();
    const seconds = field.state.value as number; // Assuming value is seconds, not Date

    // Convert seconds to the display value based on the unit
    const displayValue = useMemo(() => {
        if (typeof seconds !== "number" || isNaN(seconds)) return "";
        let value = seconds;
        if (unit === zDurationUnit.enum.Hours) value = seconds / 3600;
        else if (unit === zDurationUnit.enum.Days) value = seconds / 86400;
        else value = seconds / 60;
        return value.toString();
    }, [seconds, unit]);

    const handleValueChange = (input: string) => {
        const num = parseFloat(input);
        if (!isNaN(num)) {
            let newSeconds = num;
            if (unit === zDurationUnit.enum.Hours) newSeconds = num * 3600;
            else if (unit === zDurationUnit.enum.Days) newSeconds = num * 86400;
            else newSeconds = num * 60;
            field.handleChange(newSeconds);
        }
    };

    const handleUnitChange = (newUnit: DurationUnit) => {
        setUnit(newUnit);
        const num = parseFloat(displayValue);
        if (!isNaN(num)) {
            let newSeconds = num;
            if (newUnit === zDurationUnit.enum.Hours) newSeconds = num * 3600;
            else if (newUnit === zDurationUnit.enum.Days)
                newSeconds = num * 86400;
            else newSeconds = num * 60;
            field.handleChange(newSeconds);
        }
    };

    return (
        <div className="flex flex-col gap-1 py-2">
            <div>{label}</div>
            <div className="flex gap-2">
                <Input
                    type="number"
                    value={displayValue}
                    onChange={(e) => handleValueChange(e.target.value)}
                    placeholder="Enter duration"
                />
                <Select value={unit} onValueChange={handleUnitChange}>
                    <SelectTrigger className="w-32">
                        <SelectValue placeholder="Select unit" />
                    </SelectTrigger>
                    <SelectContent>
                        {zDurationUnit.options.map((option) => (
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
