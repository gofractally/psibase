import { QueryableMailbox } from "@/apps/chainmail/types";

type QueryKeyGenerator<Prefix extends string = string> = (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...args: any[]
) => readonly [prefix: Prefix, ...specifiers: unknown[]];

const QueryKey = {
    connectedAccounts: () => ["connectedAccounts"] as const,
    mailbox: (mailbox: QueryableMailbox, user: string) =>
        [mailbox, user] as const,
    producers: () => ["producers"] as const,
    token: (tokenId: number | undefined) => ["token", tokenId] as const,
    userLinesOfCredit: (user?: string | null) =>
        ["userLinesOfCredit", user] as const,
    userResources: () => ["userResources"] as const,
    userSettings: (user?: string | null) => ["userSettings", user] as const,
    userTokenBalances: (user?: string | null) =>
        ["userTokenBalances", user] as const,
    userTokenBalanceChanges: (user?: string | null, tokenId?: number) =>
        ["userTokenBalanceChanges", user, tokenId] as const,
} as const satisfies Record<string, QueryKeyGenerator>;

export type QueryKeysType = typeof QueryKey;
export type GeneratedQueryKey = ReturnType<QueryKeysType[keyof QueryKeysType]>;

export default QueryKey;
