import { Account } from "./zod/Account";

type QueryKeyGenerator<Prefix extends string = string> = (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...args: any[]
) => readonly [prefix: Prefix, ...specifiers: unknown[]];

export type OptionalAccount = Account | undefined | null;
export type OptionalNumber = number | undefined | null;

const QueryKey = {
    fractals: () => ["fractals"] as const,
    memberships: (user: OptionalAccount) => ["memberships", user] as const,
    fractalMemberships: (user: OptionalAccount) =>
        ["fractalMemberships", user] as const,
    currentUser: () => ["currentUser"] as const,
    chainId: () => ["chainId"] as const,
    connectedAccounts: () => ["connectedAccounts"] as const,
    createFractal: () => ["createFractal"] as const,
    selectAccount: () => ["selectAccount"] as const,
    userAccount: (account: string | undefined) => ["userAccount", account],
    fractal: (account: OptionalAccount) => ["fractal", account] as const,
    branding: () => ["branding"] as const,
    logout: () => ["logout"] as const,
    members: (account: OptionalAccount) => ["members", account] as const,
    membership: (fractal: OptionalAccount, user: OptionalAccount) =>
        ["membership", fractal, user] as const,
    evaluation: (evaluationId: OptionalNumber) =>
        ["evaluation", evaluationId] as const,
    usersAndGroups: (evaluationId: OptionalNumber) =>
        ["usersAndGroups", evaluationId] as const,
    groupUsers: (evaluationId: OptionalNumber, groupNumber: OptionalNumber) =>
        ["groupUsers", evaluationId, groupNumber] as const,
    proposal: (evaluationId: OptionalNumber, groupNumber: OptionalNumber) =>
        ["proposal", evaluationId, groupNumber] as const,
} as const satisfies Record<string, QueryKeyGenerator>;

export type QueryKeysType = typeof QueryKey;
export type GeneratedQueryKey = ReturnType<QueryKeysType[keyof QueryKeysType]>;

export default QueryKey;
