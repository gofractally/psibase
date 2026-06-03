import { useQuery } from "@tanstack/react-query";

import { fetchPremiumMarketsOverview } from "@shared/lib/graphql/prem-accounts";
import QueryKey from "@shared/lib/query-keys";

export const PREM_MARKETS_REFETCH_INTERVAL_MS = 1000;

export const usePremMarkets = () =>
    useQuery({
        queryKey: QueryKey.premMarkets(),
        queryFn: fetchPremiumMarketsOverview,
        refetchInterval: PREM_MARKETS_REFETCH_INTERVAL_MS,
    });
