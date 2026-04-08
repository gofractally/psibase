import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { graphql } from "@shared/lib/graphql";
import QueryKey from "@/lib/queryKeys";
import { MAX_PREMIUM_NAME_LENGTH, MIN_PREMIUM_NAME_LENGTH } from "@shared/lib/schemas/account";

const zRow = z.object({
    length: z
        .number()
        .int()
        .min(MIN_PREMIUM_NAME_LENGTH)
        .max(MAX_PREMIUM_NAME_LENGTH),
    enabled: z.boolean(),
    target: z.number().int().min(1),
    initialPrice: z.string(),
    floorPrice: z.string(),
    increasePpm: z.number().int().min(1).max(999_999),
    decreasePpm: z.number().int().min(1).max(999_999),
});

const zData = z.object({
    marketParams: z.array(zRow),
});

export type ConfiguredPremiumNameMarketRow = z.infer<typeof zRow>;

export const useConfiguredPremiumNameMarkets = () =>
    useQuery({
        queryKey: QueryKey.premiumNameMarkets(),
        queryFn: async (): Promise<ConfiguredPremiumNameMarketRow[]> => {
            const query = `
                query {
                    marketParams {
                        length
                        enabled
                        target
                        initialPrice
                        floorPrice
                        increasePpm
                        decreasePpm
                    }
                }
            `;
            const raw = await graphql(
                query,
                { service: "prem-accounts", path: "/graphql" },
            );
            const parsed = zData.parse(raw);
            return parsed.marketParams;
        },
    });
