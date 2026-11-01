import type { SystemTokenInfo } from "@shared/hooks/use-system-token";
import type { AccountMarketOverviewRow } from "@shared/lib/schemas/account-markets";

import { EmptyState } from "@/components/empty-state";
import { Panel } from "@/components/page-header";
import { DataTable, THead, Table, Td, Th, Tr } from "@/components/table";

import { LivePrice } from "@shared/components/live-price";
import { Badge } from "@shared/shadcn/ui/badge";
import { Skeleton } from "@shared/shadcn/ui/skeleton";

function PriceCell({
    row,
    systemToken,
}: {
    row: AccountMarketOverviewRow;
    systemToken: SystemTokenInfo;
}) {
    if (!row.configured) {
        return (
            <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                Not configured
            </Badge>
        );
    }
    if (!row.enabled) {
        return (
            <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                Disabled
            </Badge>
        );
    }

    return (
        <LivePrice
            price={row.price}
            systemToken={systemToken}
            className="font-mono tabular-nums"
            emptyClassName="text-muted-foreground"
        />
    );
}

type AccountMarketsCardProps = {
    markets: AccountMarketOverviewRow[] | undefined;
    systemToken: SystemTokenInfo | null | undefined;
    isPending: boolean;
    isError: boolean;
    error: Error | null;
};

export function AccountMarketsCard({
    markets,
    systemToken,
    isPending,
    isError,
    error,
}: AccountMarketsCardProps) {
    return (
        <Panel
            title="Market prices"
            description="Live ask by name length"
            className="self-start"
        >
            {isPending ? (
                <div className="flex flex-col gap-2 p-4">
                    {Array.from({ length: 6 }).map((_, index) => (
                        <Skeleton key={index} className="h-6 w-full" />
                    ))}
                </div>
            ) : isError ? (
                <EmptyState
                    className="text-destructive min-h-24"
                    detail={error?.message}
                >
                    Failed to load markets
                </EmptyState>
            ) : markets && systemToken ? (
                <DataTable>
                    <Table>
                        <THead>
                            <tr>
                                <Th>Length</Th>
                                <Th className="text-right">Price</Th>
                            </tr>
                        </THead>
                        <tbody>
                            {markets.map((row) => (
                                <Tr key={row.length}>
                                    <Td>
                                        <span className="font-mono tabular-nums">
                                            {row.length}
                                        </span>{" "}
                                        <span className="text-muted-foreground text-xs">
                                            {row.length === 1
                                                ? "character"
                                                : "characters"}
                                        </span>
                                    </Td>
                                    <Td className="text-right">
                                        <PriceCell
                                            row={row}
                                            systemToken={systemToken}
                                        />
                                    </Td>
                                </Tr>
                            ))}
                        </tbody>
                    </Table>
                </DataTable>
            ) : (
                <EmptyState className="min-h-24">
                    No system token configured
                </EmptyState>
            )}
        </Panel>
    );
}
