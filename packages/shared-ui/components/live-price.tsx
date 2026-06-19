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

export function LivePrice({
    price,
    systemToken,
    className,
    emptyClassName,
}: {
    price: string | null | undefined;
    systemToken: SystemTokenInfo;
    className?: string;
    emptyClassName?: string;
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
            <span
                className={cn(
                    "font-mono tabular-nums",
                    emptyClassName ?? className ?? "text-muted-foreground",
                )}
            >
                —
            </span>
        );
    }

    return (
        <span
            key={flashKey}
            className={cn(
                "rounded px-1.5 py-0.5 font-mono tabular-nums",
                className,
                flash === "up" && "animate-price-flash-up",
                flash === "down" && "animate-price-flash-down",
            )}
        >
            {new Quantity(
                price,
                systemToken.precision,
                Number(systemToken.id),
                systemToken.symbol,
            ).format({
                fullPrecision: true,
                includeLabel: true,
                showThousandsSeparator: false,
            })}
        </span>
    );
}
