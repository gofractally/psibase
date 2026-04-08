type QueryKeyGenerator<Prefix extends string = string> = (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...args: any[]
) => readonly [prefix: Prefix, ...specifiers: unknown[]];

const QueryKey = {
    availablePackages: () => ["availablePackages"] as const,
    brandingFiles: () => ["brandingFiles"] as const,
    candidates: () => ["candidates"] as const,
    installedPackages: () => ["installedPackages"] as const,
    snapshotSeconds: () => ["snapshotSeconds"] as const,
    sources: () => ["sources"] as const,
    stagedTransaction: (id: number) => ["stagedTransactions", id] as const,
    stagedTransactions: () => ["stagedTransactions"] as const,
    transactionHistory: (id: string | undefined | null) =>
        ["transactionHistory", id] as const,
    virtualServer: () => ["virtualServer"] as const,
    virtualServerPricing: () => ["virtualServer", "pricing"] as const,
    virtualServerResources: () => ["virtualServer", "resources"] as const,
    premiumNameMarkets: () =>
        ["nameMarketParams"] as const,
} as const satisfies Record<string, QueryKeyGenerator>;

export type QueryKeysType = typeof QueryKey;
export type GeneratedQueryKey = ReturnType<QueryKeysType[keyof QueryKeysType]>;

export default QueryKey;
