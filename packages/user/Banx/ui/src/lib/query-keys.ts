export const QueryKey = {
    assets: () => ["banx", "assets"] as const,
    creditLines: (account: string | null | undefined) =>
        ["banx", "creditLines", account ?? ""] as const,
    obligations: (account: string | null | undefined) =>
        ["banx", "obligations", account ?? ""] as const,
    forwardOffers: (account: string | null | undefined) =>
        ["banx", "forwardOffers", account ?? ""] as const,
    takeoutOffers: (account: string | null | undefined) =>
        ["banx", "takeoutOffers", account ?? ""] as const,
    currencyPolicies: (account: string | null | undefined) =>
        ["banx", "currencyPolicies", account ?? ""] as const,
    requests: (account: string | null | undefined) =>
        ["banx", "requests", account ?? ""] as const,
    activity: (
        account: string | null | undefined,
        counterparty: string,
        assetId: number,
    ) => ["banx", "activity", account ?? "", counterparty, assetId] as const,
};
