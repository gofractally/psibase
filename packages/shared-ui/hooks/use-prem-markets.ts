import { useQuery } from "@tanstack/react-query";

import { fetchAccountMarketsOverview } from "@shared/lib/graphql/prem-accounts";
import QueryKey from "@shared/lib/query-keys";

export const ACCOUNT_MARKETS_REFETCH_INTERVAL_MS = 1000;

export type UseAccountMarketsOptions = {
    refetchInterval?: number | false;
    enabled?: boolean;
};

export const useAccountMarkets = (options?: UseAccountMarketsOptions) =>
    useQuery({
        queryKey: QueryKey.nameMarketsOverview(),
        queryFn: fetchAccountMarketsOverview,
        refetchInterval: options?.refetchInterval ?? false,
        enabled: options?.enabled ?? true,
    });
