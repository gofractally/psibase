export const NAME_MARKET_DEFAULT_PARAMS = {
    initialPrice: "0.1000",
    floorPrice: "0.0100",
    windowAmount: "30",
    windowUnit: "Days" as const,
    target: 10,
    increasePercent: 5,
    decreasePercent: 5,
} as const;
