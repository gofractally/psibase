type QueryKeyGenerator<Prefix extends string = string> = (
    ...args: unknown[]
) => readonly [prefix: Prefix, ...specifiers: unknown[]];

const QueryKey = {
    currentUser: () => ["currentUser"] as const,
    branding: () => ["branding"] as const,
    brandingFiles: () => ["brandingFiles"] as const,
    chainId: () => ["chainId"] as const,
    connectedAccounts: () => ["connectedAccounts"] as const,
} as const satisfies Record<string, QueryKeyGenerator>;

export type QueryKeysType = typeof QueryKey;
export type GeneratedQueryKey = ReturnType<QueryKeysType[keyof QueryKeysType]>;

export default QueryKey;
