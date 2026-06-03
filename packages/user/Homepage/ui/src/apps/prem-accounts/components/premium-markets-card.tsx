import type { SystemTokenInfo } from "@shared/hooks/use-system-token";
import type { PremiumMarketOverviewRow } from "@shared/lib/schemas/prem-accounts";

import { useEffect, useRef, useState } from "react";

import { formatCanonicalPrice } from "@/apps/prem-accounts/lib/format-token";

import { GlowingCard } from "@shared/components/glowing-card";
import { Quantity } from "@shared/lib/quantity";
import { cn } from "@shared/lib/utils";
import { Badge } from "@shared/shadcn/ui/badge";
import {
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@shared/shadcn/ui/card";
import { Skeleton } from "@shared/shadcn/ui/skeleton";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@shared/shadcn/ui/table";

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

function MarketStatusBadge({ row }: { row: PremiumMarketOverviewRow }) {
    if (!row.configured) {
        return <Badge variant="outline">Not configured</Badge>;
    }
    if (row.enabled) {
        return <Badge>Enabled</Badge>;
    }
    return <Badge variant="secondary">Disabled</Badge>;
}

function PriceCell({
    row,
    systemToken,
}: {
    row: PremiumMarketOverviewRow;
    systemToken: SystemTokenInfo;
}) {
    const previousPriceRef = useRef<string | null>(null);
    const [flash, setFlash] = useState<PriceFlash | null>(null);
    const [flashKey, setFlashKey] = useState(0);

    const price = row.price;

    useEffect(() => {
        if (price === null) {
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

    if (price === null) {
        return <span className="text-muted-foreground">—</span>;
    }

    return (
        <span
            key={flashKey}
            className={cn(
                "rounded px-1.5 py-0.5 font-mono tabular-nums",
                flash === "up" && "animate-price-flash-up",
                flash === "down" && "animate-price-flash-down",
            )}
        >
            {formatCanonicalPrice(
                price,
                systemToken.precision,
                Number(systemToken.id),
                systemToken.symbol,
            )}
        </span>
    );
}

type PremiumMarketsCardProps = {
    markets: PremiumMarketOverviewRow[] | undefined;
    systemToken: SystemTokenInfo | null | undefined;
    isPending: boolean;
    isError: boolean;
    error: Error | null;
};

export function PremiumMarketsCard({
    markets,
    systemToken,
    isPending,
    isError,
    error,
}: PremiumMarketsCardProps) {
    return (
        <GlowingCard>
            <CardHeader>
                <CardTitle>Premium name markets</CardTitle>
                <CardDescription>Live prices by name length.</CardDescription>
            </CardHeader>
            <CardContent>
                {isPending ? (
                    <MarketsTableSkeleton />
                ) : isError ? (
                    <p className="text-destructive text-sm">
                        {error?.message ?? "Failed to load markets."}
                    </p>
                ) : markets && systemToken ? (
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Name length</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead className="text-right">
                                    Current price
                                </TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {markets.map((row) => (
                                <TableRow key={row.length}>
                                    <TableCell className="font-medium">
                                        {row.length}{" "}
                                        {row.length === 1
                                            ? "character"
                                            : "characters"}
                                    </TableCell>
                                    <TableCell>
                                        <MarketStatusBadge row={row} />
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <PriceCell
                                            row={row}
                                            systemToken={systemToken}
                                        />
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                ) : null}
            </CardContent>
        </GlowingCard>
    );
}

function MarketsTableSkeleton() {
    return (
        <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={index} className="h-8 w-full" />
            ))}
        </div>
    );
}
