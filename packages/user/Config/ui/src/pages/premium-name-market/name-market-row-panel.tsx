import type { SavePremiumNameMarketConfigInput } from "@/hooks/premium-name-markets/use-config-market";
import type { ConfiguredPremiumNameMarketRow } from "@/hooks/premium-name-markets/use-configured-markets";
import type { UseMutateFunction } from "@tanstack/react-query";

import { useEffect, useState } from "react";

import { Button } from "@shared/shadcn/ui/button";
import { Input } from "@shared/shadcn/ui/input";
import { Label } from "@shared/shadcn/ui/label";

import { parsePct, parsePositiveInt } from "./parsers";

export type NameMarketRowPanelProps = {
    row: ConfiguredPremiumNameMarketRow;
    saveConfig: UseMutateFunction<
        unknown,
        Error,
        SavePremiumNameMarketConfigInput,
        unknown
    >;
    savingLength: number | null;
    disablingLength: number | null;
    enablingLength: number | null;
    actionsDisabled: boolean;
};

export function NameMarketRowPanel({
    row,
    saveConfig,
    savingLength,
    disablingLength,
    enablingLength,
    actionsDisabled,
}: NameMarketRowPanelProps) {
    const [floorPrice, setFloorPrice] = useState(row.floorPrice);
    const [targetRaw, setTargetRaw] = useState(String(row.target));
    const [increasePctRaw, setIncreasePctRaw] = useState(
        String(row.increasePct),
    );
    const [decreasePctRaw, setDecreasePctRaw] = useState(
        String(row.decreasePct),
    );

    useEffect(() => {
        setFloorPrice(row.floorPrice);
        setTargetRaw(String(row.target));
        setIncreasePctRaw(String(row.increasePct));
        setDecreasePctRaw(String(row.decreasePct));
    }, [
        row.length,
        row.floorPrice,
        row.target,
        row.increasePct,
        row.decreasePct,
    ]);

    const target = parsePositiveInt(targetRaw);
    const increasePct = parsePct(increasePctRaw);
    const decreasePct = parsePct(decreasePctRaw);
    const pricesOk =
        floorPrice.trim() !== "" &&
        target !== null &&
        increasePct !== null &&
        decreasePct !== null;

    return (
        <div className="flex max-w-lg flex-col gap-4 pt-2">
            <div className="grid gap-2">
                <Label htmlFor={`pm-floor-${row.length}`}>Floor price</Label>
                <Input
                    id={`pm-floor-${row.length}`}
                    value={floorPrice}
                    onChange={(e) => setFloorPrice(e.target.value)}
                    autoComplete="off"
                    className="font-mono"
                    disabled={actionsDisabled}
                />
            </div>
            <div className="grid gap-2">
                <Label htmlFor={`pm-target-${row.length}`}>
                    Target sales per window
                </Label>
                <Input
                    id={`pm-target-${row.length}`}
                    inputMode="numeric"
                    value={targetRaw}
                    onChange={(e) => setTargetRaw(e.target.value)}
                    autoComplete="off"
                    className="font-mono"
                    disabled={actionsDisabled}
                />
            </div>
            <div className="grid gap-2">
                <Label htmlFor={`pm-inc-pct-${row.length}`}>
                    Increase percent
                </Label>
                <Input
                    id={`pm-inc-pct-${row.length}`}
                    inputMode="numeric"
                    value={increasePctRaw}
                    onChange={(e) => setIncreasePctRaw(e.target.value)}
                    autoComplete="off"
                    className="font-mono"
                    disabled={actionsDisabled}
                />
            </div>
            <div className="grid gap-2">
                <Label htmlFor={`pm-dec-pct-${row.length}`}>
                    Decrease percent
                </Label>
                <Input
                    id={`pm-dec-pct-${row.length}`}
                    inputMode="numeric"
                    value={decreasePctRaw}
                    onChange={(e) => setDecreasePctRaw(e.target.value)}
                    autoComplete="off"
                    className="font-mono"
                    disabled={actionsDisabled}
                />
            </div>
            <Button
                type="button"
                disabled={
                    actionsDisabled ||
                    !pricesOk ||
                    savingLength === row.length ||
                    disablingLength === row.length ||
                    enablingLength === row.length
                }
                onClick={() => {
                    if (
                        target === null ||
                        increasePct === null ||
                        decreasePct === null
                    ) {
                        return;
                    }
                    saveConfig({
                        row,
                        target,
                        floorPrice: floorPrice.trim(),
                        increasePct,
                        decreasePct,
                    });
                }}
            >
                {savingLength === row.length ? "Saving…" : "Save parameters"}
            </Button>
        </div>
    );
}
