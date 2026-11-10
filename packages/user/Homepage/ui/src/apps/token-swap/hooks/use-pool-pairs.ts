import type { TokenIconSource } from "@shared/components/token-icon";

import { useMemo } from "react";

import { usePools } from "./use-pools";

export type PoolPair = readonly [TokenIconSource, TokenIconSource];

/**
 * Maps each liquidity token id to its pool's reserve tokens, for rendering LP
 * token icons. Empty while loading or when the pools query fails (e.g. the
 * token-swap package isn't installed).
 */
export const usePoolPairs = (): Map<number, PoolPair> => {
    const { data: pools } = usePools(false);

    return useMemo(
        () =>
            new Map(
                (pools ?? []).map((pool) => [
                    pool.liquidityToken,
                    [
                        { tokenId: pool.tokenAId, icon: pool.tokenAIcon },
                        { tokenId: pool.tokenBId, icon: pool.tokenBIcon },
                    ] as const,
                ]),
            ),
        [pools],
    );
};
