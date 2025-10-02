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
    guildMemberships: (fractal: OptionalAccount, user: OptionalAccount) =>
        ["guildMemberships", fractal, user] as const,
    guildBySlug: (fractal: OptionalAccount, slug: OptionalAccount) =>
        ["guildBySlug", fractal, slug] as const,
    currentUser: () => ["currentUser"] as const,
    chainId: () => ["chainId"] as const,
    connectedAccounts: () => ["connectedAccounts"] as const,
    createGuild: () => ["createGuild"] as const,
    selectAccount: () => ["selectAccount"] as const,
    userAccount: (account: string | undefined) => ["userAccount", account],
    fractal: (account: OptionalAccount) => ["fractal", account] as const,
    branding: () => ["branding"] as const,
    logout: () => ["logout"] as const,
    members: (account: OptionalAccount) => ["members", account] as const,
    scores: (guildId: OptionalNumber) => ["scores", guildId] as const,
    membership: (fractal: OptionalAccount, user: OptionalAccount) =>
        ["membership", fractal, user] as const,
    evaluation: (evaluationId: OptionalNumber) =>
        ["evaluation", evaluationId] as const,
    completedEvaluations: () => ["completedEvaluations"] as const,
    evaluationResults: (evaluationId: OptionalNumber) =>
        ["evaluationResults", evaluationId] as const,
    usersAndGroups: (evaluationId: OptionalNumber) =>
        ["usersAndGroups", evaluationId] as const,
    groupUsers: (slug: OptionalAccount, groupNumber: OptionalNumber) =>
        ["groupUsers", slug, groupNumber] as const,
    proposal: (guildSlug: OptionalAccount, groupNumber: OptionalNumber) =>
        ["proposal", guildSlug, groupNumber] as const,
} as const satisfies Record<string, QueryKeyGenerator>;

export type QueryKeysType = typeof QueryKey;
export type GeneratedQueryKey = ReturnType<QueryKeysType[keyof QueryKeysType]>;

export default QueryKey;
