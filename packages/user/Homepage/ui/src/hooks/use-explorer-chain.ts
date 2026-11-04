import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { parseChainTime } from "@/lib/format";
import QueryKey from "@/lib/query-keys";

import { useIsPackageInstalled } from "@shared/hooks/use-is-package-installed";
import {
    type GraphqlPluginCall,
    graphqlAuth,
} from "@shared/lib/graphql/graphql-auth";
import {
    type PluginCall,
    callPluginFunction,
} from "@shared/lib/plugins/lib/call-plugin-function";

/** psibase numbers the genesis block 2; there is no block 1. */
const GENESIS_BLOCK = 2;
const POLL_MS = 2000;
const STALL_MS = 6000;
/** Blocks counted by the most-active-apps leaderboard (about 10 minutes at 1 block/s). */
const ACTIVITY_WINDOW = 600;
const ACTIVITY_POLL_MS = 15_000;
/** Matches the explorer's "My dashboard" seed window (about 5 minutes at 1 block/s). */
const USER_ACTIVITY_WINDOW = 300;
const USER_ACTIVITY_POLL_MS = 5000;
const USER_ACTIVITY_SPARK_BLOCKS = 90;

export type ExplorerFeedStatus = "connecting" | "live" | "stalled" | "error";

/** `undefined` until the installed-packages check resolves. */
export const useExplorerInstalled = (): boolean | undefined => {
    const { data, isPending } = useIsPackageInstalled("Explorer");
    return isPending ? undefined : data === true;
};

/** Only call this when the Explorer package is installed. */
const explorerGraphql: GraphqlPluginCall = {
    service: "homepage",
    plugin: "explorer",
    intf: "authorized",
    method: "graphql",
};

const queryExplorer = async <T>(query: string, schema: z.ZodType<T>) =>
    schema.parse(await graphqlAuth(explorerGraphql, query));

const zGenesisResponse = z.object({
    block: z.object({ header: z.object({ time: z.string() }) }).nullable(),
});

const zHeadResponse = z.object({
    head: z.object({ blockNum: z.number() }).nullable(),
});

interface HeadObservation {
    blockNum: number | null;
    /** Local time at which `blockNum` was first seen. */
    advancedAt: number;
}

export const useGenesisTime = (enabled = true) =>
    useQuery({
        queryKey: QueryKey.explorerGenesisTime(),
        queryFn: async () => {
            const res = await queryExplorer(
                `{ block(blockNum: ${GENESIS_BLOCK}) { header { time } } }`,
                zGenesisResponse,
            );
            return res.block?.header.time ?? null;
        },
        enabled,
        staleTime: Infinity,
    });

/** Polls the explorer service's head block to report whether its feed is live. */
export const useExplorerFeed = (enabled = true) => {
    const queryClient = useQueryClient();
    const queryKey = QueryKey.explorerHead();

    const head = useQuery({
        queryKey,
        queryFn: async (): Promise<HeadObservation> => {
            const res = await queryExplorer(
                "{ head { blockNum } }",
                zHeadResponse,
            );
            const blockNum = res.head?.blockNum ?? null;
            const previous =
                queryClient.getQueryData<HeadObservation>(queryKey);
            return {
                blockNum,
                advancedAt:
                    previous?.blockNum === blockNum
                        ? previous.advancedAt
                        : Date.now(),
            };
        },
        enabled,
        refetchInterval: POLL_MS,
        retry: false,
    });

    const lastPollAt = Math.max(head.dataUpdatedAt, head.errorUpdatedAt);

    const status: ExplorerFeedStatus = head.isError
        ? "error"
        : !head.data
          ? "connecting"
          : head.dataUpdatedAt - head.data.advancedAt > STALL_MS
            ? "stalled"
            : "live";

    return { status, lastPollAt: lastPollAt || null };
};

const zBlocksPage = z.object({
    blocks: z.object({
        pageInfo: z.object({ hasPreviousPage: z.boolean() }),
        edges: z.array(
            z.object({
                node: z.object({
                    header: z.object({ blockNum: z.number(), time: z.string() }),
                    actionsReceived: z.array(
                        z.object({ service: z.string(), count: z.number() }),
                    ),
                }),
            }),
        ),
    }),
});

type BlockActivity = z.infer<typeof zBlocksPage>["blocks"]["edges"][number]["node"];

export interface ServiceActivity {
    /** Most active first. */
    services: { service: string; count: number }[];
    windowBlocks: number;
    windowSeconds: number;
}

/** Pages back from the head, since the service caps each page by stored block size. */
const fetchRecentBlocks = async (count: number) => {
    const blocks: BlockActivity[] = [];
    while (blocks.length < count) {
        const oldest = blocks[0]?.header.blockNum;
        const range = [
            `last: ${count - blocks.length}`,
            ...(oldest !== undefined ? [`lt: ${oldest}`] : []),
        ].join(", ");
        const page = await queryExplorer(
            `{ blocks(${range}) {
                pageInfo { hasPreviousPage }
                edges { node { header { blockNum time } actionsReceived { service count } } }
            } }`,
            zBlocksPage,
        );
        blocks.unshift(...page.blocks.edges.map((e) => e.node));
        if (!page.blocks.pageInfo.hasPreviousPage || page.blocks.edges.length === 0)
            break;
    }
    return blocks;
};

/**
 * Every block but genesis starts with a system transaction holding a single
 * `transact::startBlock` action, which is excluded.
 */
const userActionsReceived = (block: BlockActivity) =>
    block.actionsReceived
        .map(({ service, count }) => ({
            service,
            count:
                service === "transact" && block.header.blockNum !== GENESIS_BLOCK
                    ? count - 1
                    : count,
        }))
        .filter(({ service, count }) => service !== "" && count > 0);

const fetchServiceActivity = async (): Promise<ServiceActivity> => {
    const blocks = await fetchRecentBlocks(ACTIVITY_WINDOW);
    const counts = new Map<string, number>();
    for (const block of blocks) {
        for (const { service, count } of userActionsReceived(block)) {
            counts.set(service, (counts.get(service) ?? 0) + count);
        }
    }
    const first = blocks[0]?.header.time;
    const last = blocks[blocks.length - 1]?.header.time;
    return {
        services: [...counts.entries()]
            .map(([service, count]) => ({ service, count }))
            .sort((a, b) => b.count - a.count),
        windowBlocks: blocks.length,
        windowSeconds:
            first && last
                ? (parseChainTime(last).getTime() -
                      parseChainTime(first).getTime()) /
                  1000
                : 0,
    };
};

/** Actions each service received across the recent block window, excluding system actions. */
export const useServiceActivity = (enabled = true) =>
    useQuery({
        queryKey: QueryKey.explorerServiceActivity(),
        queryFn: fetchServiceActivity,
        enabled,
        refetchInterval: ACTIVITY_POLL_MS,
    });

interface BlockRange {
    gt?: number;
    lt?: number;
    first?: number;
    last?: number;
}

/**
 * The service redacts transactions the viewer isn't a party to, so reading the
 * user's own actions needs their credentials, which the explorer plugin attaches.
 * Only call this when the Explorer package is installed.
 */
const getBlocks: PluginCall<[range: BlockRange], string> = {
    service: "homepage",
    plugin: "explorer",
    intf: "block-log",
    method: "getBlocks",
};

const zUserBlocksPage = z.object({
    pageInfo: z.object({
        hasPreviousPage: z.boolean(),
        hasNextPage: z.boolean(),
    }),
    edges: z.array(
        z.object({
            node: z.object({
                header: z.object({ blockNum: z.number(), time: z.string() }),
                transactions: z
                    .array(
                        z.object({
                            transaction: z
                                .object({
                                    actions: z.array(
                                        z.object({ sender: z.string() }),
                                    ),
                                })
                                .nullable(),
                        }),
                    )
                    .nullable(),
            }),
        }),
    ),
});

interface UserBlock {
    blockNum: number;
    time: string;
    /** Top-level actions the user sent in this block. */
    sent: number;
}

const fetchUserBlocksPage = async (user: string, range: BlockRange) => {
    const page = zUserBlocksPage.parse(
        JSON.parse(await callPluginFunction(getBlocks, [range])),
    );
    return {
        pageInfo: page.pageInfo,
        blocks: page.edges.map(({ node }): UserBlock => ({
            blockNum: node.header.blockNum,
            time: node.header.time,
            sent: (node.transactions ?? []).reduce(
                (n, trx) =>
                    n +
                    (trx.transaction?.actions.filter((a) => a.sender === user)
                        .length ?? 0),
                0,
            ),
        })),
    };
};

/** Pages back from the head, since the service caps each page by stored block size. */
const seedUserBlocks = async (user: string) => {
    const blocks: UserBlock[] = [];
    while (blocks.length < USER_ACTIVITY_WINDOW) {
        const oldest = blocks[0]?.blockNum;
        const page = await fetchUserBlocksPage(user, {
            last: USER_ACTIVITY_WINDOW - blocks.length,
            ...(oldest !== undefined && { lt: oldest }),
        });
        blocks.unshift(...page.blocks);
        if (!page.pageInfo.hasPreviousPage || page.blocks.length === 0) break;
    }
    return blocks;
};

/** Appends blocks newer than the cached window, or reseeds if it fell too far behind. */
const fetchUserBlocks = async (user: string, previous?: UserBlock[]) => {
    const newest = previous?.[previous.length - 1]?.blockNum;
    if (newest === undefined) return seedUserBlocks(user);
    const page = await fetchUserBlocksPage(user, {
        gt: newest,
        first: USER_ACTIVITY_WINDOW,
    });
    if (page.pageInfo.hasNextPage) return seedUserBlocks(user);
    return [...previous!, ...page.blocks].slice(-USER_ACTIVITY_WINDOW);
};

export interface UserActivity {
    actionsSent: number;
    /** Per-block actions sent across the most recent blocks, oldest first. */
    spark: number[];
    windowBlocks: number;
    windowSeconds: number;
}

const summarizeUserActivity = (blocks: UserBlock[]): UserActivity => {
    const first = blocks[0]?.time;
    const last = blocks[blocks.length - 1]?.time;
    return {
        actionsSent: blocks.reduce((n, b) => n + b.sent, 0),
        spark: blocks.slice(-USER_ACTIVITY_SPARK_BLOCKS).map((b) => b.sent),
        windowBlocks: blocks.length,
        windowSeconds:
            first && last
                ? (parseChainTime(last).getTime() -
                      parseChainTime(first).getTime()) /
                  1000
                : 0,
    };
};

/** Actions the user sent across the recent block window. */
export const useUserActivity = (user: string | null | undefined) => {
    const queryClient = useQueryClient();
    const queryKey = QueryKey.explorerUserActivity(user);
    return useQuery({
        queryKey,
        queryFn: () =>
            fetchUserBlocks(
                user!,
                queryClient.getQueryData<UserBlock[]>(queryKey),
            ),
        enabled: !!user,
        refetchInterval: USER_ACTIVITY_POLL_MS,
        select: summarizeUserActivity,
    });
};
