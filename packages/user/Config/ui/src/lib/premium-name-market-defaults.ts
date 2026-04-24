import {
    MAX_ACCOUNT_NAME_LENGTH,
    MIN_ACCOUNT_NAME_LENGTH,
} from "@shared/lib/schemas/account";

export const PREMIUM_MARKET_DEFAULT_WINDOW_SECONDS = 30 * 86400;
export const PREMIUM_MARKET_DEFAULT_PPM = 50_000;

/** Matches on-chain `create` / `configure` length bounds (account name length). */
export const MIN_PREMIUM_NAME_LENGTH_MARKET = MIN_ACCOUNT_NAME_LENGTH;
export const MAX_PREMIUM_NAME_LENGTH_MARKET = MAX_ACCOUNT_NAME_LENGTH;

export const PREMIUM_MARKET_DEFAULTS = {
    initialPrice: "0.1000",
    floorPrice: "0.0100",
    target: 10,
    increasePpm: PREMIUM_MARKET_DEFAULT_PPM,
    decreasePpm: PREMIUM_MARKET_DEFAULT_PPM,
} as const;
