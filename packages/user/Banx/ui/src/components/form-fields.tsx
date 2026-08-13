/**
 * Thin wrappers for Banx-specific controls inside TanStack `form.Field`.
 * Shared form fields (TextField, etc.) come from useAppForm's AppField.
 */
import { AssetSelect } from "@/components/asset-select";
import { ExpiresAtPicker } from "@/components/expires-at-picker";
import type { Asset } from "@/lib/graphql";

import { Label } from "@shared/shadcn/ui/label";

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
                <AssetSelect
                    assets={assets}
                    value={value}
                    onChange={onChange}
                />
            )}
        </div>
    );
}

export function ExpiresField({
    value,
    onChange,
}: {
    value: number;
    onChange: (seconds: number) => void;
}) {
    return <ExpiresAtPicker value={value} onChange={onChange} />;
}
