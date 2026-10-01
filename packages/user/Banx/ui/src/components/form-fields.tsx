/**
 * Thin wrappers for Banx-specific controls inside TanStack `form.Field`.
 * Shared form fields (TextField, etc.) come from useAppForm's AppField.
 */
import type { ReactNode } from "react";

import { CurrencyPicker } from "@/components/currency-picker";
import { ExpiresAtPicker } from "@/components/expires-at-picker";
import type { Asset } from "@/lib/graphql";
import {
    GRACE_PRESET_DAYS,
    type GracePreset,
} from "@/lib/constants";

import { cn } from "@shared/lib/utils";
import { Input } from "@shared/shadcn/ui/input";
import { Label } from "@shared/shadcn/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@shared/shadcn/ui/select";

export function amountUnit(symbol: string | undefined) {
    if (!symbol) return undefined;
    return (
        <span className="text-foreground flex h-full shrink-0 items-center border-l px-3 text-sm">
            {symbol}
        </span>
    );
}

/** Cover a locked specific-offer form when a live global offer is in effect. */
export function UsingGlobalSettingsOverlay({
    active,
    children,
}: {
    active: boolean;
    children: ReactNode;
}) {
    return (
        <div className="relative">
            {children}
            {active ? (
                <div
                    className={cn(
                        "bg-background/80 absolute inset-0 z-10 flex items-center justify-center rounded-md backdrop-blur-[2px]",
                    )}
                    role="status"
                >
                    <p className="text-muted-foreground max-w-[16rem] px-4 text-center text-sm leading-snug">
                        Currently set to{" "}
                        <span className="text-foreground font-medium">
                            global
                        </span>{" "}
                        settings
                    </p>
                </div>
            ) : null}
        </div>
    );
}

export function AssetField({
    label = "Asset",
    assets,
    value,
    onChange,
    disabled,
}: {
    label?: string;
    assets: Asset[];
    value: number | undefined;
    onChange: (id: number) => void;
    disabled?: boolean;
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
                <CurrencyPicker
                    variant="field"
                    assets={assets}
                    assetId={value}
                    onAssetId={onChange}
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
