import type { SystemTokenInfo } from "@shared/hooks/use-system-token";

import { useEffect, useRef, useState } from "react";

import { Quantity } from "@shared/lib/quantity";
import { cn } from "@shared/lib/utils";

type PriceFlash = "up" | "down";

function comparePrices(
    previous: string,
    next: string,
    precision: number,
): PriceFlash | null {
    const prevQty = new Quantity(previous, precision, 0);
    const nextQty = new Quantity(next, precision, 0);
    if (prevQty.equals(nextQty)) {
        return null;
    }
    if (nextQty.isGreaterThan(prevQty)) {
        return "up";
    }
    return "down";
}

function formatLivePrice(
    canonical: string,
    systemToken: SystemTokenInfo,
): string {
    return new Quantity(
        canonical,
        systemToken.precision,
        Number(systemToken.id),
        systemToken.symbol,
    ).format({
        fullPrecision: true,
        includeLabel: true,
        showThousandsSeparator: false,
    });
}

export function LiveMarketPrice({
    price,
    systemToken,
}: {
    price: string | null | undefined;
    systemToken: SystemTokenInfo;
}) {
    const previousPriceRef = useRef<string | null>(null);
    const [flash, setFlash] = useState<PriceFlash | null>(null);
    const [flashKey, setFlashKey] = useState(0);

    useEffect(() => {
        if (price == null) {
            previousPriceRef.current = null;
            return;
        }

        const previous = previousPriceRef.current;
        if (previous !== null && previous !== price) {
            const direction = comparePrices(
                previous,
                price,
                systemToken.precision,
            );
            if (direction) {
                setFlash(direction);
                setFlashKey((key) => key + 1);
            }
        }

        previousPriceRef.current = price;
    }, [price, systemToken.precision]);

    useEffect(() => {
        if (!flash) {
            return;
        }
        const timeoutId = window.setTimeout(() => setFlash(null), 800);
        return () => window.clearTimeout(timeoutId);
    }, [flash, flashKey]);

    if (price == null) {
        return (
            <span className="text-muted-foreground font-mono text-xs tabular-nums">
                —
            </span>
        );
    }

    return (
        <span
            key={flashKey}
            className={cn(
                "text-muted-foreground rounded px-1 py-0.5 font-mono text-xs tabular-nums",
                flash === "up" && "animate-price-flash-up",
                flash === "down" && "animate-price-flash-down",
            )}
        >
            {formatLivePrice(price, systemToken)}
        </span>
    );
}
