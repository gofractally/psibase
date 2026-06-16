export const PREMIUM_MARKET_DEFAULT_WINDOW_SECONDS = 30 * 86400;
export const PREMIUM_MARKET_DEFAULT_PPM = 50_000;
export const PREMIUM_MARKET_DEFAULT_PERCENT =
    PREMIUM_MARKET_DEFAULT_PPM / 10_000;

export const PREMIUM_MARKET_DEFAULT_PARAMS = {
    initialPrice: "0.1000",
    floorPrice: "0.0100",
    target: 10,
    increasePercent: String(PREMIUM_MARKET_DEFAULT_PERCENT),
    decreasePercent: String(PREMIUM_MARKET_DEFAULT_PERCENT),
} as const;
