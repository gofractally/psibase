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
    const usd = assets.find((a) => a.symbol === "USD" || a.symbol.toLowerCase() === "usd");
    return (usd ?? assets[0]).id;
}

function StatusDot({ on }: { on: boolean }) {
    return (
        <span
            aria-hidden
            className={
                on
                    ? "size-2 shrink-0 rounded-full bg-emerald-500"
                    : "size-2 shrink-0 rounded-full bg-red-500"
            }
        />
    );
}

export function AssetSelect({
    assets,
    value,
    onChange,
    placeholder = "Asset",
    /**
     * When set, each option shows a green/red status dot and assets with
     * `true` are listed first (stable within each group).
     */
    itemActive,
}: {
    assets: Asset[];
    value?: number;
    onChange: (id: number) => void;
    placeholder?: string;
    itemActive?: (asset: Asset) => boolean;
}) {
    const ordered = useMemo(() => {
        if (!itemActive) return assets;
        return [...assets].sort((a, b) => {
            const aOn = itemActive(a) ? 0 : 1;
            const bOn = itemActive(b) ? 0 : 1;
            if (aOn !== bOn) return aOn - bOn;
            return a.symbol.localeCompare(b.symbol);
        });
    }, [assets, itemActive]);

    const fallbackId = useMemo(() => defaultAssetId(ordered), [ordered]);
    // Always show a concrete selection when we can (avoids blank Radix Select).
    const effectiveId = value ?? fallbackId;

    useEffect(() => {
        if (value !== undefined || fallbackId === undefined) return;
        onChange(fallbackId);
    }, [value, fallbackId, onChange]);

    const row = (a: Asset) => {
        const sym = a.symbol.toUpperCase();
        if (!itemActive) return sym;
        return (
            <span className="flex items-center gap-2">
                <StatusDot on={itemActive(a)} />
                {sym}
            </span>
        );
    };

    const selected = ordered.find((x) => x.id === effectiveId);

    return (
        <Select
            value={
                effectiveId !== undefined ? String(effectiveId) : undefined
            }
            onValueChange={(v) => onChange(Number(v))}
        >
            <SelectTrigger>
                <SelectValue placeholder={placeholder}>
                    {selected ? row(selected) : undefined}
                </SelectValue>
            </SelectTrigger>
            <SelectContent>
                {ordered.map((a) => (
                    <SelectItem key={a.id} value={String(a.id)}>
                        {row(a)}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}
