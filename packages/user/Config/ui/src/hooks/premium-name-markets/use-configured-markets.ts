import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { graphql } from "@shared/lib/graphql";
import {
    MAX_ACCOUNT_NAME_LENGTH,
    MIN_ACCOUNT_NAME_LENGTH,
} from "@shared/lib/schemas/account";

import QueryKey from "../../lib/query-keys";

const zRow = z.object({
    length: z
        .number()
        .int()
        .min(MIN_ACCOUNT_NAME_LENGTH)
        .max(MAX_ACCOUNT_NAME_LENGTH),
    enabled: z.boolean(),
    target: z.number().int().min(1),
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
                        floorPrice
                        increasePpm
                        decreasePpm
                    }
                }
            `;
            const raw = await graphql(query, { service: "prem-accounts" });
            const parsed = zData.parse(raw);
            return parsed.marketParams;
        },
    });
