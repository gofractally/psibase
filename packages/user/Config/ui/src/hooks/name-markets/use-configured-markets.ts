import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { graphql } from "@shared/lib/graphql";
import { nameMarket } from "@shared/lib/plugins";
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
    increasePct: z.number().int().min(1).max(99),
    decreasePct: z.number().int().min(1).max(99),
    initialPrice: z.string(),
    windowSeconds: z.number().int().min(1),
});

const zData = z.object({
    marketParams: z.array(zRow),
});

export type ConfiguredNameMarketRow = z.infer<typeof zRow>;

export const useConfiguredNameMarkets = () =>
    useQuery({
        queryKey: QueryKey.nameMarketParams(),
        queryFn: async (): Promise<ConfiguredNameMarketRow[]> => {
            const query = `
                query {
                    marketParams {
                        length
                        enabled
                        target
                        initialPrice
                        floorPrice
                        increasePct
                        decreasePct
                        windowSeconds
                    }
                }
            `;
            const raw = await graphql(query, { service: nameMarket.service });
            const parsed = zData.parse(raw);
            return parsed.marketParams;
        },
    });
