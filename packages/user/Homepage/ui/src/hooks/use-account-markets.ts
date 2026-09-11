import { useQuery } from "@tanstack/react-query";

import {
    ACCOUNT_MARKETS_REFETCH_INTERVAL_MS,
    type UseAccountMarketsOptions,
} from "@shared/hooks/use-account-markets";
import { callPluginFunction, homepage } from "@shared/lib/plugins";
import QueryKey from "@shared/lib/query-keys";
import {
    type AccountMarketOverviewRow,
    buildAccountMarketOverviewRows,
} from "@shared/lib/schemas/account-markets";

export { ACCOUNT_MARKETS_REFETCH_INTERVAL_MS };

export const useAccountMarkets = (options?: UseAccountMarketsOptions) =>
    useQuery({
        queryKey: QueryKey.nameMarketsOverview(),
        queryFn: async (): Promise<AccountMarketOverviewRow[]> => {
            const overview = await callPluginFunction(
                homepage.accountsMarketplace.getMarketsOverview,
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
