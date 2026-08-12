import { useEffect, useMemo } from "react";

import type { Asset } from "@/lib/graphql";

import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@shared/shadcn/ui/select";

/** Prefer USD; otherwise first listed asset. */
export function defaultAssetId(assets: Asset[]): number | undefined {
    if (assets.length === 0) return undefined;
    const usd = assets.find((a) => a.symbol.toLowerCase() === "usd");
    return (usd ?? assets[0]).id;
}

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
    const fallbackId = useMemo(() => defaultAssetId(assets), [assets]);
    // Always show a concrete selection when we can (avoids blank Radix Select).
    const effectiveId = value ?? fallbackId;

    useEffect(() => {
        if (value !== undefined || fallbackId === undefined) return;
        onChange(fallbackId);
    }, [value, fallbackId, onChange]);

    return (
        <Select
            value={
                effectiveId !== undefined ? String(effectiveId) : undefined
            }
            onValueChange={(v) => onChange(Number(v))}
        >
            <SelectTrigger>
                <SelectValue placeholder={placeholder} />
            </SelectTrigger>
            <SelectContent>
                {assets.map((a) => (
                    <SelectItem key={a.id} value={String(a.id)}>
                        {a.symbol.toUpperCase()}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}
