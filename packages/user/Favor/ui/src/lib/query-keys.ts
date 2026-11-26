export const QueryKey = {
    assets: () => ["favor", "assets"] as const,
    creditLines: (account: string | null | undefined) =>
        ["favor", "creditLines", account ?? ""] as const,
    bookAuths: (account: string | null | undefined) =>
        ["favor", "bookAuths", account ?? ""] as const,
    obligations: (account: string | null | undefined) =>
        ["favor", "obligations", account ?? ""] as const,
    forwardOffers: (account: string | null | undefined) =>
        ["favor", "forwardOffers", account ?? ""] as const,
    claimOffers: (account: string | null | undefined) =>
        ["favor", "claimOffers", account ?? ""] as const,
    buyClaimOffers: (account: string | null | undefined) =>
        ["favor", "claimOffers", account ?? ""] as const,
    fxOffers: (account: string | null | undefined) =>
        ["favor", "fxOffers", account ?? ""] as const,
    cashQuotes: (poster: string | null | undefined) =>
        ["favor", "cashQuotes", poster ?? "*"] as const,
    favorRelays: (owner: string | null | undefined) =>
        ["favor", "favorRelays", owner ?? "*"] as const,
    tokenRelays: (owner: string | null | undefined) =>
        ["favor", "tokenRelays", owner ?? "*"] as const,
    cashVault: (account: string | null | undefined) =>
        ["favor", "cashVault", account ?? ""] as const,
    tokenPrecision: (tokenId: number) =>
        ["favor", "tokenPrecision", tokenId] as const,
    requests: (account: string | null | undefined) =>
        ["favor", "requests", account ?? ""] as const,
    payAuths: (account: string | null | undefined) =>
        ["favor", "payAuths", account ?? ""] as const,
    invites: (account: string | null | undefined) =>
        ["favor", "invites", account ?? ""] as const,
    activity: (
        account: string | null | undefined,
        counterparty: string,
        assetId: number,
    ) => ["favor", "activity", account ?? "", counterparty, assetId] as const,
    activityWith: (
        account: string | null | undefined,
        counterparty: string,
    ) => ["favor", "activityWith", account ?? "", counterparty] as const,
    activityFeed: (account: string | null | undefined) =>
        ["favor", "activityFeed", account ?? ""] as const,
};
