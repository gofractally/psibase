export const PREMIUM_MARKET_DEFAULT_WINDOW_SECONDS = 30 * 86400;

export const PREMIUM_MARKET_DEFAULT_PARAMS = {
    initialPrice: "0.1000",
    floorPrice: "0.0100",
    target: 10,
    increasePercent: 5,
    decreasePercent: 5,
} as const;
