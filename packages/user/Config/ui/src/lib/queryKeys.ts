import { Account } from "./zod/Account";

type QueryKeyGenerator<Prefix extends string = string> = (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...args: any[]
) => readonly [prefix: Prefix, ...specifiers: unknown[]];

const QueryKey = {
    currentUser: () => ["currentUser"] as const,
    branding: () => ["branding"] as const,
    snapshotSeconds: () => ["snapshotSeconds"] as const,
    brandingFiles: () => ["brandingFiles"] as const,
    chainId: () => ["chainId"] as const,
    connectedAccounts: () => ["connectedAccounts"] as const,
    availablePackages: () => ["availablePackages"] as const,
    installedPackages: () => ["installedPackages"] as const,
    stagedTransactions: () => ["stagedTransactions"] as const,
    stagedTransaction: (id: number) => ["stagedTransactions", id] as const,
    stagedTransactionsByUser: (account: Account) =>
        ["stagedTransactionsByUser", account] as const,
    transactionHistory: (id: string | undefined | null) =>
        ["transactionHistory", id] as const,
    sources: () => ["sources"] as const,
} as const satisfies Record<string, QueryKeyGenerator>;

export type QueryKeysType = typeof QueryKey;
export type GeneratedQueryKey = ReturnType<QueryKeysType[keyof QueryKeysType]>;

export default QueryKey;
