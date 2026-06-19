import type { SystemTokenInfo } from "@shared/hooks/use-system-token";
import type { PremiumMarketOverviewRow } from "@shared/lib/schemas/prem-accounts";

import { GlowingCard } from "@shared/components/glowing-card";
import { LivePrice } from "@shared/components/live-price";
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

function PriceCell({
    row,
    systemToken,
}: {
    row: PremiumMarketOverviewRow;
    systemToken: SystemTokenInfo;
}) {
    if (!row.configured) {
        return <Badge variant="outline">Not configured</Badge>;
    }
    if (!row.enabled) {
        return <Badge variant="secondary">Disabled</Badge>;
    }

    return (
        <LivePrice
            price={row.price}
            systemToken={systemToken}
            emptyClassName="text-muted-foreground"
        />
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
