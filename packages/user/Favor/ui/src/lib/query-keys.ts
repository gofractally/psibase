export const QueryKey = {
    assets: () => ["banx", "assets"] as const,
    creditLines: (account: string | null | undefined) =>
        ["banx", "creditLines", account ?? ""] as const,
    bookAuths: (account: string | null | undefined) =>
        ["banx", "bookAuths", account ?? ""] as const,
    obligations: (account: string | null | undefined) =>
        ["banx", "obligations", account ?? ""] as const,
    forwardOffers: (account: string | null | undefined) =>
        ["banx", "forwardOffers", account ?? ""] as const,
    claimOffers: (account: string | null | undefined) =>
        ["banx", "claimOffers", account ?? ""] as const,
    buyClaimOffers: (account: string | null | undefined) =>
        ["banx", "claimOffers", account ?? ""] as const,
    fxOffers: (account: string | null | undefined) =>
        ["banx", "fxOffers", account ?? ""] as const,
    cashQuotes: (poster: string | null | undefined) =>
        ["banx", "cashQuotes", poster ?? "*"] as const,
    banxRelays: (owner: string | null | undefined) =>
        ["banx", "banxRelays", owner ?? "*"] as const,
    tokenRelays: (owner: string | null | undefined) =>
        ["banx", "tokenRelays", owner ?? "*"] as const,
    cashVault: (account: string | null | undefined) =>
        ["banx", "cashVault", account ?? ""] as const,
    tokenPrecision: (tokenId: number) =>
        ["banx", "tokenPrecision", tokenId] as const,
    requests: (account: string | null | undefined) =>
        ["banx", "requests", account ?? ""] as const,
    payAuths: (account: string | null | undefined) =>
        ["banx", "payAuths", account ?? ""] as const,
    invites: (account: string | null | undefined) =>
        ["banx", "invites", account ?? ""] as const,
    activity: (
        account: string | null | undefined,
        counterparty: string,
        assetId: number,
    ) => ["banx", "activity", account ?? "", counterparty, assetId] as const,
    activityWith: (
        account: string | null | undefined,
        counterparty: string,
    ) => ["banx", "activityWith", account ?? "", counterparty] as const,
    activityFeed: (account: string | null | undefined) =>
        ["banx", "activityFeed", account ?? ""] as const,
};
