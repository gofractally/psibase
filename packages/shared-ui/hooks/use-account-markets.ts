import { useQuery } from "@tanstack/react-query";

import {
    type GraphqlPluginCall,
    fetchAccountMarketsOverview,
} from "@shared/lib/graphql/namemarket";
import QueryKey from "@shared/lib/query-keys";

export const ACCOUNT_MARKETS_REFETCH_INTERVAL_MS = 1000;

export type UseAccountMarketsOptions = {
    refetchInterval?: number | false;
    enabled?: boolean;
};

export const useAccountMarkets = (
    graphql: GraphqlPluginCall,
    options?: UseAccountMarketsOptions,
) =>
    useQuery({
        queryKey: [...QueryKey.nameMarketsOverview(), graphql.service],
        queryFn: () => fetchAccountMarketsOverview(graphql),
        refetchInterval: options?.refetchInterval ?? false,
        enabled: options?.enabled ?? true,
    });
