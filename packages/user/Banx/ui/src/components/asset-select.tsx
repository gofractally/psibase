import { useEffect, useMemo, useRef } from "react";

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
    /** Overrides the closed-trigger dot (e.g. the Enabled switch). */
    selectedActive,
    className,
}: {
    assets: Asset[];
    value?: number;
    onChange: (id: number) => void;
    placeholder?: string;
    itemActive?: (asset: Asset) => boolean;
    selectedActive?: boolean;
    className?: string;
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
    const ids = useMemo(() => new Set(ordered.map((a) => a.id)), [ordered]);
    // Never pass Radix a value that isn't in the list (empty assets / stale URL id).
    const valueInList = value !== undefined && ids.has(value);
    const effectiveId = valueInList ? value : fallbackId;
    const pushedFallback = useRef<number | undefined>(undefined);

    useEffect(() => {
        if (valueInList || fallbackId === undefined) return;
        if (value === fallbackId) return;
        if (pushedFallback.current === fallbackId) return;
        pushedFallback.current = fallbackId;
        onChange(fallbackId);
    }, [valueInList, value, fallbackId, onChange]);

    const row = (a: Asset, active: boolean | undefined) => {
        const sym = a.symbol.toUpperCase();
        if (active === undefined) return sym;
        return (
            <span className="flex items-center gap-2">
                <StatusDot on={active} />
                {sym}
            </span>
        );
    };

    const selected = ordered.find((x) => x.id === effectiveId);
    const triggerActive =
        selectedActive !== undefined
            ? selectedActive
            : selected && itemActive
              ? itemActive(selected)
              : undefined;

    return (
        <Select
            value={
                effectiveId !== undefined ? String(effectiveId) : undefined
            }
            onValueChange={(v) => onChange(Number(v))}
        >
            <SelectTrigger className={className}>
                <SelectValue placeholder={placeholder}>
                    {selected ? row(selected, triggerActive) : undefined}
                </SelectValue>
            </SelectTrigger>
            <SelectContent>
                {ordered.map((a) => (
                    <SelectItem key={a.id} value={String(a.id)}>
                        {row(
                            a,
                            a.id === effectiveId &&
                                selectedActive !== undefined
                                ? selectedActive
                                : itemActive?.(a),
                        )}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}
