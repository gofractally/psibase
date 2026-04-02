import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@shared/shadcn/ui/select";

interface TimeUnitSelectProps {
    value: string | null | undefined;
    onChange: (value: "sec" | "min") => void;
}

export const TimeUnitSelect = ({ value, onChange }: TimeUnitSelectProps) => {
    return (
        <Select
            value={value ?? "sec"}
            onValueChange={(v) => onChange(v as "sec" | "min")}
        >
            <SelectTrigger className="w-24">
                <SelectValue />
            </SelectTrigger>
            <SelectContent>
                <SelectItem value="sec">sec</SelectItem>
                <SelectItem value="min">min</SelectItem>
            </SelectContent>
        </Select>
    );
};

type TimeUnit = "ns" | "us" | "ms";

interface PerBlockSysCpuUnitSelectProps {
    value: TimeUnit;
    onChange: (value: TimeUnit) => void;
}

export const PerBlockSysCpuUnitSelect = ({
    value,
    onChange,
}: PerBlockSysCpuUnitSelectProps) => {
    return (
        <Select
            value={value}
            onValueChange={(v) => onChange(v as TimeUnit)}
        >
            <SelectTrigger className="w-24">
                <SelectValue />
            </SelectTrigger>
            <SelectContent>
                <SelectItem value="ns">ns</SelectItem>
                <SelectItem value="us">us</SelectItem>
                <SelectItem value="ms">ms</SelectItem>
            </SelectContent>
        </Select>
    );
};

type StorageUnit = "GB" | "TB" | "PB";

interface StorageUnitSelectProps {
    value: StorageUnit;
    onChange: (value: StorageUnit) => void;
}

export const StorageUnitSelect = ({ value, onChange }: StorageUnitSelectProps) => {
    return (
        <Select
            value={value}
            onValueChange={(v) => onChange(v as StorageUnit)}
        >
            <SelectTrigger className="w-24">
                <SelectValue />
            </SelectTrigger>
            <SelectContent>
                <SelectItem value="GB">GB</SelectItem>
                <SelectItem value="TB">TB</SelectItem>
                <SelectItem value="PB">PB</SelectItem>
            </SelectContent>
        </Select>
    );
};

