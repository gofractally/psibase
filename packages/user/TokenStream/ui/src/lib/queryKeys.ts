import { Account } from "./types/account";

type QueryKeyGenerator<Prefix extends string = string> = (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...args: any[]
) => readonly [prefix: Prefix, ...specifiers: unknown[]];

export type OptionalAccount = Account | undefined | null;
export type OptionalNumber = number | undefined | null;

const QueryKey = {
    streams: () => ["streams"] as const,
    currentUser: () => ["currentUser"] as const,
    stream: (id: OptionalNumber) => ["streams", id] as const,
    nft: (id: OptionalNumber) => ["nft", id] as const,
} as const satisfies Record<string, QueryKeyGenerator>;

export type QueryKeysType = typeof QueryKey;
export type GeneratedQueryKey = ReturnType<QueryKeysType[keyof QueryKeysType]>;

export default QueryKey;
