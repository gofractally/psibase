import { useQuery } from "@tanstack/react-query";

import { siblingUrl } from "@psibase/common-lib";

import { graphql } from "@/lib/graphql";
import QueryKey from "@/lib/queryKeys";

type MarketStatus = {
    length: number;
    enabled: boolean;
};

type MarketsStatusResponse = {
    marketsStatus: MarketStatus[];
};

export const usePremiumMarkets = () =>
    useQuery({
        queryKey: QueryKey.premiumMarkets(),
        queryFn: async () => {
            const query = `
                query {
                    marketsStatus {
                        length
                        enabled
                    }
                }
            `;

            const url = siblingUrl(null, "prem-accounts", "/graphql");

            const res = await graphql<MarketsStatusResponse>(query, url);

            return res.marketsStatus;
        },
    });

