import { Account } from "@shared/lib/schemas/account";

type QueryKeyGenerator<Prefix extends string = string> = (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...args: any[]
) => readonly [prefix: Prefix, ...specifiers: unknown[]];

export type OptionalAccount = Account | undefined | null;
export type OptionalNumber = number | undefined | null;

const QueryKey = {
    fractals: () => ["fractals"] as const,
    guildMemberships: (user: OptionalAccount) =>
        ["guildMemberships", user] as const,
    guildMembership: (guild: OptionalAccount, member: OptionalAccount) =>
        ["guildMembership", guild, member] as const,
    guild: (guild: OptionalAccount) => ["guild", guild] as const,
    fractal: (account: OptionalAccount) => ["fractal", account] as const,
    members: (fractalAccount: OptionalAccount) =>
        ["members", fractalAccount] as const,
    scores: (guildAccount: OptionalAccount) =>
        ["scores", guildAccount] as const,
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
    guildApplications: (guildAccount: OptionalAccount) =>
        ["guildApplications", guildAccount] as const,
    guildApplication: (
        guildAccount: OptionalAccount,
        applicant: OptionalAccount,
    ) => ["guildApplication", guildAccount, applicant] as const,
    proposal: (guildAccount: OptionalAccount, groupNumber: OptionalNumber) =>
        ["proposal", guildAccount, groupNumber] as const,
} as const satisfies Record<string, QueryKeyGenerator>;

export type QueryKeysType = typeof QueryKey;
export type GeneratedQueryKey = ReturnType<QueryKeysType[keyof QueryKeysType]>;

export default QueryKey;
