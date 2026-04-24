import { MIN_ACCOUNT_NAME_LENGTH } from "@shared/lib/schemas/account";

export const PREMIUM_MARKET_DEFAULT_WINDOW_SECONDS = 30 * 86400;
export const PREMIUM_MARKET_DEFAULT_PPM = 50_000;

export const DEFAULT_MIN_PREMIUM_NAME_LENGTH_MARKET = MIN_ACCOUNT_NAME_LENGTH;
export const DEFAULT_MAX_PREMIUM_NAME_LENGTH_MARKET = 7;

export const PREMIUM_MARKET_DEFAULT_PARAMS = {
    initialPrice: "0.1000",
    floorPrice: "0.0100",
    target: 10,
    increasePpm: PREMIUM_MARKET_DEFAULT_PPM,
    decreasePpm: PREMIUM_MARKET_DEFAULT_PPM,
} as const;
