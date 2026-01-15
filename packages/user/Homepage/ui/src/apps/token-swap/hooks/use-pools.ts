import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { zAccount } from "@/lib/zod/Account";

import { graphql } from "@shared/lib/graphql";

export const PoolSchema = z.object({
    id: z.number().int().positive(),
    tokenAId: z.number().int(),
    tokenBId: z.number().int(),
    tokenATariffPpm: z.number().int(),
    tokenBTariffPpm: z.number().int(),
    aBalance: z.string(),
    bBalance: z.string(),
    tokenASymbol: zAccount.nullable(),
    tokenBSymbol: zAccount.nullable(),
    liquidityToken: z.number().int().positive(),
    liquidityTokenSupply: z.string(),
});

export type PoolInstance = z.infer<typeof PoolSchema>;

export const PoolsResponseSchema = z.object({
    allPools: z.object({
        nodes: z.array(PoolSchema),
    }),
});

export const usePools = () => {
    return useQuery({
        queryKey: ["pools"],
        queryFn: async () => {
            const res = await graphql(
                `
                    {
                        allPools {
                            nodes {
                                id
                                tokenAId
                                tokenASymbol
                                tokenBId
                                tokenAId
                                tokenATariffPpm
                                tokenBTariffPpm
                                aBalance
                                tokenBSymbol
                                bBalance
                                liquidityToken
                                liquidityTokenSupply
                            }
                        }
                    }
                `,
                "token-swap",
                false,
            );

            return PoolsResponseSchema.parse(res).allPools.nodes;
        },
    });
};
