import { usePremiumMarketsStatus } from "@/hooks/use-premium-markets-status";
import { useUpdatePremiumMarketStatus } from "@/hooks/use-update-premium-market-status";

import { Switch } from "@shared/shadcn/ui/switch";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@shared/shadcn/ui/table";

export const PremiumMarketConfig = () => {
    const { data: rows, isLoading, isError, error } = usePremiumMarketsStatus();
    const { mutate, isPending, variables } = useUpdatePremiumMarketStatus();

    return (
        <div className="mx-auto w-full max-w-screen-lg space-y-6 px-2">
            <div>
                <h2 className="text-lg font-medium">Premium Market Config</h2>
                <p className="text-muted-foreground text-sm">
                    Enable or disable new purchases for each premium account
                    name length (1–9). Disabling a market blocks new buys for
                    that length; existing purchases can still be claimed.
                </p>
            </div>

            {isError ? (
                <p className="text-destructive text-sm">
                    {error instanceof Error
                        ? error.message
                        : "Could not load market status."}
                </p>
            ) : null}

            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Market (account name length)</TableHead>
                        <TableHead className="w-[200px] text-right">
                            Purchases enabled
                        </TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {isLoading ? (
                        <TableRow>
                            <TableCell
                                colSpan={3}
                                className="text-muted-foreground"
                            >
                                Loading…
                            </TableCell>
                        </TableRow>
                    ) : rows && rows.length > 0 ? (
                        rows.map((row) => {
                            const togglingThis =
                                isPending &&
                                variables &&
                                variables[0] === row.length;
                            return (
                                <TableRow key={row.length}>
                                    <TableCell className="font-mono">
                                        Length {row.length}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <div className="flex items-center justify-end gap-3">
                                            <Switch
                                                id={`market-${row.length}`}
                                                checked={row.enabled}
                                                disabled={togglingThis}
                                                onCheckedChange={(enable) => {
                                                    mutate([
                                                        row.length,
                                                        enable,
                                                    ]);
                                                }}
                                            />
                                        </div>
                                    </TableCell>
                                </TableRow>
                            );
                        })
                    ) : (
                        <TableRow>
                            <TableCell
                                colSpan={3}
                                className="text-muted-foreground"
                            >
                                No market data available.
                            </TableCell>
                        </TableRow>
                    )}
                </TableBody>
            </Table>
        </div>
    );
};
