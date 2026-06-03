import { useQuery } from "@tanstack/react-query";

import { fetchPremiumMarketsOverview } from "@shared/lib/graphql/prem-accounts";
import QueryKey from "@shared/lib/query-keys";

export const PREM_MARKETS_REFETCH_INTERVAL_MS = 1000;

export type UsePremMarketsOptions = {
    refetchInterval?: number | false;
};

export const usePremMarkets = (options?: UsePremMarketsOptions) =>
    useQuery({
        queryKey: QueryKey.premMarkets(),
        queryFn: fetchPremiumMarketsOverview,
        refetchInterval:
            options?.refetchInterval ?? false,
    });
