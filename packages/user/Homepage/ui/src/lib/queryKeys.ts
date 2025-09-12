import { QueryableMailbox } from "@/apps/chainmail/types";

type QueryKeyGenerator<Prefix extends string = string> = (
    ...args: any[]
) => readonly [prefix: Prefix, ...specifiers: unknown[]];

const QueryKey = {
    tokenBalances: (user?: string | null) => ["balances", user] as const,
    ui: (user: string | undefined) => ["ui", user] as const,
    contacts: (user: string | undefined | null) => ["contacts", user] as const,
    profile: (account: string | undefined | null) =>
        ["profile", account] as const,
    currentUser: () => ["currentUser"] as const,
    mailbox: (mailbox: QueryableMailbox, user: string) =>
        [mailbox, user] as const,
} as const satisfies Record<string, QueryKeyGenerator>;

export type QueryKeysType = typeof QueryKey;
export type GeneratedQueryKey = ReturnType<QueryKeysType[keyof QueryKeysType]>;

export default QueryKey;
