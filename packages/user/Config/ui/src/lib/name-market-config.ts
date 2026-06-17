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

export const PPM_PER_PCT = 10_000;

export function ppmToPct(ppm: number): number {
    const pct = Math.round(ppm / PPM_PER_PCT);
    if (!Number.isFinite(pct) || pct < 1 || pct > 255) {
        throw new Error(`Adjust rate must map to 1–255% (got PPM ${ppm})`);
    }
    return pct;
}

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
        increasePct: overrides.increasePct ?? ppmToPct(row.increasePpm),
        decreasePct: overrides.decreasePct ?? ppmToPct(row.decreasePpm),
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
        increasePct: ppmToPct(PREMIUM_MARKET_DEFAULT_PARAMS.increasePpm),
        decreasePct: ppmToPct(PREMIUM_MARKET_DEFAULT_PARAMS.decreasePpm),
        enabled: true,
        initialPrice: PREMIUM_MARKET_DEFAULT_PARAMS.initialPrice,
    };
}
