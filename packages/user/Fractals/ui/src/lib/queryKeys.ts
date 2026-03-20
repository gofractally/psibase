import type { Account } from "@shared/lib/schemas/account";

type QueryKeyGenerator<Prefix extends string = string> = (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...args: any[]
) => readonly [prefix: Prefix, ...specifiers: unknown[]];

export type OptionalAccount = Account | undefined | null;
export type OptionalNumber = number | undefined | null;

const QueryKey = {
    createFractal: () => ["createFractal"] as const,
    currentUser: () => ["currentUser"] as const,
    fractal: (account: OptionalAccount) => ["fractal", account] as const,
    fractals: () => ["fractals"] as const,
    logout: () => ["logout"] as const,
    membership: (fractal: OptionalAccount, user: OptionalAccount) =>
        ["membership", fractal, user] as const,
    memberships: (user: OptionalAccount) => ["memberships", user] as const,
    userAccount: (account: string | undefined) => ["userAccount", account],
} as const satisfies Record<string, QueryKeyGenerator>;

export type QueryKeysType = typeof QueryKey;
export type GeneratedQueryKey = ReturnType<QueryKeysType[keyof QueryKeysType]>;

export default QueryKey;
