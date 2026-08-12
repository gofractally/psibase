import type { Asset } from "@/lib/graphql";

import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@shared/shadcn/ui/select";

export function AssetSelect({
    assets,
    value,
    onChange,
    placeholder = "Asset",
}: {
    assets: Asset[];
    value?: number;
    onChange: (id: number) => void;
    placeholder?: string;
}) {
    return (
        <Select
            value={value !== undefined ? String(value) : undefined}
            onValueChange={(v) => onChange(Number(v))}
        >
            <SelectTrigger>
                <SelectValue placeholder={placeholder} />
            </SelectTrigger>
            <SelectContent>
                {assets.map((a) => (
                    <SelectItem key={a.id} value={String(a.id)}>
                        {a.symbol.toUpperCase()}{" "}
                        <span className="text-muted-foreground">
                            (id {a.id}, {a.precision} dp)
                        </span>
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}
