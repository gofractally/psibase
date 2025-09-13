import { Account } from "./types/account";

type QueryKeyGenerator<Prefix extends string = string> = (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...args: any[]
) => readonly [prefix: Prefix, ...specifiers: unknown[]];

export type OptionalAccount = Account | undefined | null;
export type OptionalString = string | undefined | null;

const QueryKey = {
    streams: () => ["streams"] as const,
    currentUser: () => ["currentUser"] as const,
    token: (id: OptionalString) => ["token", id] as const,
    stream: (id: OptionalString) => ["streams", id] as const,
    nft: (id: OptionalString) => ["nft", id] as const,
} as const satisfies Record<string, QueryKeyGenerator>;

export type QueryKeysType = typeof QueryKey;
export type GeneratedQueryKey = ReturnType<QueryKeysType[keyof QueryKeysType]>;

export default QueryKey;
