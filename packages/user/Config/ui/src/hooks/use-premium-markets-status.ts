import { siblingUrl } from "@psibase/common-lib";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { graphql } from "@/lib/graphql";
import QueryKey from "@/lib/queryKeys";

const zMarketRow = z.object({
    length: z.number().int().min(1).max(9),
    enabled: z.boolean(),
});

const zMarketsStatusData = z.object({
    marketsStatus: z.array(zMarketRow),
});

export type PremiumMarketRow = z.infer<typeof zMarketRow>;

export const usePremiumMarketsStatus = () =>
    useQuery({
        queryKey: QueryKey.premiumMarketsStatus(),
        queryFn: async (): Promise<PremiumMarketRow[]> => {
            const query = `
                query {
                    marketsStatus {
                        length
                        enabled
                    }
                }
            `;
            const raw = await graphql(
                query,
                siblingUrl(null, "prem-accounts", "/graphql"),
            );
            const parsed = zMarketsStatusData.parse(raw);
            return parsed.marketsStatus;
        },
    });
