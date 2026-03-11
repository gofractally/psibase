import { useMutation, useQueryClient } from "@tanstack/react-query";

import { usePremiumMarkets } from "@/hooks/use-premium-markets";
import { usePremAccountsPlugin } from "@/hooks/use-prem-accounts-plugin";

import { Badge } from "@shared/shadcn/ui/badge";
import { Button } from "@shared/shadcn/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@shared/shadcn/ui/card";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@shared/shadcn/ui/table";

import QueryKey from "@/lib/queryKeys";

export const PremiumMarketConfig = () => {
    const queryClient = useQueryClient();
    const { data: markets, isLoading, isError } = usePremiumMarkets();

    const { mutateAsync: updateMarketStatus } = usePremAccountsPlugin(
        "updateMarketStatus",
        {
            loading: "Updating market status",
            success: "Updated market status",
            error: "Failed to update market status",
            isStagable: false,
        },
    );

    const { mutateAsync: toggleMarket } = useMutation({
        mutationKey: QueryKey.premiumMarkets(),
        mutationFn: async (params: { length: number; enable: boolean }) => {
            await updateMarketStatus([params.length, params.enable]);
        },
        onSuccess: async () => {
            await queryClient.invalidateQueries({
                queryKey: QueryKey.premiumMarkets(),
            });
        },
    });

    return (
        <div className="mx-auto w-full max-w-screen-lg space-y-6 px-2">
            <div>
                <h2 className="text-lg font-medium">Premium Market Config</h2>
                <p className="text-muted-foreground text-sm">
                    View and manage the status of premium account name markets.
                </p>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Markets</CardTitle>
                </CardHeader>
                <CardContent>
                    {isLoading && (
                        <p className="text-sm text-muted-foreground">Loading markets…</p>
                    )}
                    {isError && (
                        <p className="text-sm text-red-500">
                            Failed to load premium markets. Please try again.
                        </p>
                    )}
                    {!isLoading && !isError && markets && (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Market (account name length)</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead className="text-right">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {markets.map((market) => (
                                    <TableRow key={market.length}>
                                        <TableCell>{market.length}</TableCell>
                                        <TableCell>
                                            <Badge
                                                variant={
                                                    market.enabled
                                                        ? "default"
                                                        : "secondary"
                                                }
                                            >
                                                {market.enabled ? "Enabled" : "Disabled"}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <Button
                                                variant={market.enabled ? "destructive" : "default"}
                                                size="sm"
                                                onClick={() =>
                                                    toggleMarket({
                                                        length: market.length,
                                                        enable: !market.enabled,
                                                    })
                                                }
                                            >
                                                {market.enabled ? "Disable" : "Enable"}
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>
        </div>
    );
};

