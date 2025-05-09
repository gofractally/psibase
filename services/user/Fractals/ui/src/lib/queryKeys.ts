import { Account } from "./zodTypes";

type QueryKeyGenerator<Prefix extends string = string> = (
    ...args: any[]
) => readonly [prefix: Prefix, ...specifiers: unknown[]];

const QueryKey = {
    currentUser: () => ["currentUser"] as const,
    chainId: () => ["chainId"] as const,
    connectedAccounts: () => ["connectedAccounts"] as const,
    createFractal: () => ["createFractal"] as const,
    selectAccount: () => ["selectAccount"] as const,
    userAccount: (account: string | undefined) => ["userAccount", account],
    fractal: (account: Account | undefined | null) =>
        ["fractal", account] as const,
    branding: () => ["branding"] as const,
    logout: () => ['logout'] as const,
} as const satisfies Record<string, QueryKeyGenerator>;

export type QueryKeysType = typeof QueryKey;
export type GeneratedQueryKey = ReturnType<QueryKeysType[keyof QueryKeysType]>;

export default QueryKey;
