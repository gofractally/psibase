import type { UseMutateFunction } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import type { ConfiguredPremiumNameMarketRow } from "@/hooks/premium-name-markets/use-configured-markets";
import { PREMIUM_MARKET_DEFAULT_WINDOW_SECONDS } from "@/lib/premium-name-market-defaults";

import { Button } from "@shared/shadcn/ui/button";
import { Input } from "@shared/shadcn/ui/input";
import { Label } from "@shared/shadcn/ui/label";

import { parsePpm, parsePositiveInt } from "./parsers";

type SaveMarketConfigParams = [
    number,
    number,
    number,
    string,
    number,
    number,
];

export type NameMarketRowPanelProps = {
    row: ConfiguredPremiumNameMarketRow;
    saveConfig: UseMutateFunction<
        unknown,
        Error,
        SaveMarketConfigParams,
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
    const [increasePpmRaw, setIncreasePpmRaw] = useState(
        String(row.increasePpm),
    );
    const [decreasePpmRaw, setDecreasePpmRaw] = useState(
        String(row.decreasePpm),
    );

    useEffect(() => {
        setFloorPrice(row.floorPrice);
        setTargetRaw(String(row.target));
        setIncreasePpmRaw(String(row.increasePpm));
        setDecreasePpmRaw(String(row.decreasePpm));
    }, [
        row.length,
        row.floorPrice,
        row.target,
        row.increasePpm,
        row.decreasePpm,
    ]);

    const target = parsePositiveInt(targetRaw);
    const increasePpm = parsePpm(increasePpmRaw);
    const decreasePpm = parsePpm(decreasePpmRaw);
    const pricesOk =
        floorPrice.trim() !== "" &&
        target !== null &&
        increasePpm !== null &&
        decreasePpm !== null;

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
                <Label htmlFor={`pm-inc-ppm-${row.length}`}>Increase PPM</Label>
                <Input
                    id={`pm-inc-ppm-${row.length}`}
                    inputMode="numeric"
                    value={increasePpmRaw}
                    onChange={(e) => setIncreasePpmRaw(e.target.value)}
                    autoComplete="off"
                    className="font-mono"
                    disabled={actionsDisabled}
                />
            </div>
            <div className="grid gap-2">
                <Label htmlFor={`pm-dec-ppm-${row.length}`}>Decrease PPM</Label>
                <Input
                    id={`pm-dec-ppm-${row.length}`}
                    inputMode="numeric"
                    value={decreasePpmRaw}
                    onChange={(e) => setDecreasePpmRaw(e.target.value)}
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
                        increasePpm === null ||
                        decreasePpm === null
                    ) {
                        return;
                    }
                    saveConfig([
                        row.length,
                        PREMIUM_MARKET_DEFAULT_WINDOW_SECONDS,
                        target,
                        floorPrice.trim(),
                        increasePpm,
                        decreasePpm,
                    ]);
                }}
            >
                {savingLength === row.length ? "Saving…" : "Save parameters"}
            </Button>
        </div>
    );
}
