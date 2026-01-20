import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { graphql } from "@shared/lib/graphql";
import { Account, zAccount } from "@shared/lib/schemas/account";

const zInt = z.number().int();

const zReserve = z.object({
    poolId: zInt,
    tokenId: zInt,
    tariffPpm: zInt,
    adminNft: zInt,
    balance: z.string(),
    symbol: zAccount.nullable(),
});

export const PoolSchema = z.object({
    liquidityToken: zInt,
    liquidityTokenSupply: z.string(),
    reserveA: zReserve,
    reserveB: zReserve,
});

export type PoolInstance = z.infer<typeof PoolSchema>;

export type EnrichedPool = PoolInstance & {
    id: number;
    tokenAId: number;
    tokenBId: number;
    tokenATariffPpm: number;
    tokenBTariffPpm: number;
    aBalance: string;
    bBalance: string;
    tokenASymbol?: Account | null;
    tokenBSymbol?: Account | null;
};

export const PoolsResponseSchema = z.object({
    allPools: z.object({
        nodes: z.array(PoolSchema),
    }),
});

export const usePools = (refetchInterval = 12000) => {
    return useQuery<EnrichedPool[]>({
        queryKey: ["pools"],
        refetchInterval,
        queryFn: async () => {
            const res = await graphql(
                `
                    {
                        allPools {
                            nodes {
                                liquidityToken
                                liquidityTokenSupply
                                reserveA {
                                    poolId
                                    tokenId
                                    tariffPpm
                                    adminNft
                                    balance
                                    symbol
                                }
                                reserveB {
                                    poolId
                                    tokenId
                                    tariffPpm
                                    adminNft
                                    balance
                                    symbol
                                }
                            }
                        }
                    }
                `,
                "token-swap",
                false,
            );

            const rawPools = PoolsResponseSchema.parse(res).allPools.nodes;

            return rawPools.map((pool) => {
                const [resA, resB] = [pool.reserveA, pool.reserveB].sort(
                    (a, b) => a.tokenId - b.tokenId,
                );

                return {
                    ...pool,
                    id: pool.liquidityToken,
                    tokenAId: resA.tokenId,
                    tokenBId: resB.tokenId,
                    tokenATariffPpm: resA.tariffPpm,
                    tokenBTariffPpm: resB.tariffPpm,
                    aBalance: resA.balance,
                    bBalance: resB.balance,
                    tokenASymbol: resA.symbol,
                    tokenBSymbol: resB.symbol,
                } satisfies EnrichedPool;
            });
        },
    });
};
