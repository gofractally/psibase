import type { ConfiguredPremiumNameMarketRow } from "@/hooks/premium-name-markets/use-configured-markets";

import {
    PREMIUM_MARKET_DEFAULT_PARAMS,
    PREMIUM_MARKET_DEFAULT_WINDOW_SECONDS,
} from "./premium-name-market-defaults";

/** Matches `market-config` in config:plugin/name-market (camelCase for supervisor calls). */
export type NameMarketConfigInput = {
    length: number;
    windowSeconds: number;
    target: number;
    floorPrice: string;
    increasePct: number;
    decreasePct: number;
    enabled: boolean;
    initialPrice?: string | null;
};

export function rowToMarketConfig(
    row: ConfiguredPremiumNameMarketRow,
    overrides: Partial<
        Omit<NameMarketConfigInput, "length" | "windowSeconds">
    > = {},
): NameMarketConfigInput {
    return {
        length: row.length,
        windowSeconds: PREMIUM_MARKET_DEFAULT_WINDOW_SECONDS,
        target: overrides.target ?? row.target,
        floorPrice: overrides.floorPrice ?? row.floorPrice,
        increasePct: overrides.increasePct ?? row.increasePct,
        decreasePct: overrides.decreasePct ?? row.decreasePct,
        enabled: overrides.enabled ?? row.enabled,
        initialPrice: overrides.initialPrice ?? null,
    };
}

export function defaultMarketConfigForLength(
    length: number,
): NameMarketConfigInput {
    return {
        length,
        windowSeconds: PREMIUM_MARKET_DEFAULT_WINDOW_SECONDS,
        target: PREMIUM_MARKET_DEFAULT_PARAMS.target,
        floorPrice: PREMIUM_MARKET_DEFAULT_PARAMS.floorPrice,
        increasePct: PREMIUM_MARKET_DEFAULT_PARAMS.increasePct,
        decreasePct: PREMIUM_MARKET_DEFAULT_PARAMS.decreasePct,
        enabled: true,
        initialPrice: PREMIUM_MARKET_DEFAULT_PARAMS.initialPrice,
    };
}
