import { useQuery } from "@tanstack/react-query";

import { fetchCurrentPrices } from "@shared/lib/graphql/prem-accounts";
import QueryKey from "@shared/lib/query-keys";

export const usePremPrices = () =>
    useQuery({
        queryKey: QueryKey.premPrices(),
        queryFn: fetchCurrentPrices,
    });
