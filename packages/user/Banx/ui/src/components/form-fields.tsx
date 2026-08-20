/**
 * Thin wrappers for Banx-specific controls inside TanStack `form.Field`.
 * Shared form fields (TextField, etc.) come from useAppForm's AppField.
 */
import { AssetSelect } from "@/components/asset-select";
import { ExpiresAtPicker } from "@/components/expires-at-picker";
import type { Asset } from "@/lib/graphql";
import {
    GRACE_PRESET_DAYS,
    type GracePreset,
} from "@/lib/constants";

import { Input } from "@shared/shadcn/ui/input";
import { Label } from "@shared/shadcn/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@shared/shadcn/ui/select";

export function AssetField({
    label = "Asset",
    assets,
    value,
    onChange,
    disabled,
    itemActive,
}: {
    label?: string;
    assets: Asset[];
    value: number | undefined;
    onChange: (id: number) => void;
    disabled?: boolean;
    /** Green/red status dots + sort actives first (see AssetSelect). */
    itemActive?: (asset: Asset) => boolean;
}) {
    return (
        <div className="grid gap-2">
            <Label>{label}</Label>
            {disabled && value !== undefined ? (
                <div className="text-muted-foreground border-input bg-muted/40 flex h-9 items-center rounded-md border px-3 text-sm">
                    {assets.find((a) => a.id === value)?.symbol.toUpperCase() ??
                        `Asset #${value}`}
                </div>
            ) : (
                <AssetSelect
                    assets={assets}
                    value={value}
                    onChange={onChange}
                    itemActive={itemActive}
                />
            )}
        </div>
    );
}

export function ExpiresField({
    value,
    onChange,
    disabled,
}: {
    value: number;
    onChange: (seconds: number) => void;
    disabled?: boolean;
}) {
    return (
        <ExpiresAtPicker
            value={value}
            onChange={onChange}
            disabled={disabled}
        />
    );
}

export function GracePeriodField({
    preset,
    days,
    onPresetChange,
    onDaysChange,
}: {
    preset: GracePreset;
    days: string;
    onPresetChange: (preset: GracePreset) => void;
    onDaysChange: (days: string) => void;
}) {
    return (
        <div className="grid gap-2">
            <Label>Interest-free period</Label>
            <Select
                value={preset}
                onValueChange={(v) => onPresetChange(v as GracePreset)}
            >
                <SelectTrigger>
                    <SelectValue placeholder="7 days" />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {GRACE_PRESET_DAYS.map((d) => (
                        <SelectItem key={d} value={String(d)}>
                            {d === 1 ? "1 day" : `${d} days`}
                        </SelectItem>
                    ))}
                    <SelectItem value="custom">Custom</SelectItem>
                </SelectContent>
            </Select>
            {preset === "custom" ? (
                <Input
                    inputMode="numeric"
                    value={days}
                    onChange={(e) => onDaysChange(e.target.value)}
                    placeholder="Days"
                    aria-label="Custom interest-free days"
                />
            ) : null}
        </div>
    );
}
