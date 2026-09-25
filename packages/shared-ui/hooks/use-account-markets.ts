import { useQuery } from "@tanstack/react-query";

import { hostingAppCall } from "@shared/lib/plugins/host-app";
import {
    type PluginCall,
    callPluginFunction,
} from "@shared/lib/plugins/lib/call-plugin-function";
import { type MarketsOverview } from "@shared/lib/plugins/namemarket";
import QueryKey from "@shared/lib/query-keys";
import {
    type AccountMarketOverviewRow,
    buildAccountMarketOverviewRows,
} from "@shared/lib/schemas/account-markets";

export const ACCOUNT_MARKETS_REFETCH_INTERVAL_MS = 1000;

export type UseAccountMarketsOptions = {
    refetchInterval?: number | false;
    enabled?: boolean;
    call?: PluginCall<[], MarketsOverview>;
};

export const useAccountMarkets = (options?: UseAccountMarketsOptions) =>
    useQuery({
        queryKey: QueryKey.nameMarketsOverview(),
        queryFn: async (): Promise<AccountMarketOverviewRow[]> => {
            const overview = await callPluginFunction(
                options?.call ??
                    hostingAppCall<[], MarketsOverview>(
                        "name-market",
                        "getMarketsOverview",
                    ),
                [],
            );
            return buildAccountMarketOverviewRows(
                overview.marketParams,
                overview.currentPrices,
            );
        },
        refetchInterval: options?.refetchInterval ?? false,
        enabled: options?.enabled ?? true,
    });
