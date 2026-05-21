import { useQuery } from "@tanstack/react-query";

import { fetchCurrentPrices } from "@/apps/prem-accounts/lib/graphql/prem-accounts-api";
import QueryKey from "@/lib/query-keys";

export const usePremPrices = () =>
    useQuery({
        queryKey: QueryKey.premPrices(),
        queryFn: fetchCurrentPrices,
    });
