export const MIN_PREMIUM_NAME_LENGTH = 1;
export const MAX_PREMIUM_NAME_LENGTH = 15;

export const PREMIUM_MARKET_DEFAULT_WINDOW_SECONDS = 30 * 86400;
export const PREMIUM_MARKET_DEFAULT_PPM = 50_000;

export const PREMIUM_MARKET_DEFAULTS = {
    initialPrice: "0.1000",
    floorPrice: "0.0100",
    target: 10,
    increasePpm: PREMIUM_MARKET_DEFAULT_PPM,
    decreasePpm: PREMIUM_MARKET_DEFAULT_PPM,
} as const;
