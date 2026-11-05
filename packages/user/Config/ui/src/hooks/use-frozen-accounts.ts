import { useInfiniteQuery } from "@tanstack/react-query";
import { z } from "zod";

import QueryKey from "@/lib/query-keys";

import { graphqlAuth } from "@shared/lib/graphql/graphql-auth";
import { config } from "@shared/lib/plugins";

const PAGE_SIZE = 50;

const zFrozenPage = z.object({
    frozenAccounts: z.object({
        edges: z.array(
            z.object({
                node: z.object({
                    account: z.string(),
                    authService: z.string(),
                }),
            }),
        ),
        pageInfo: z.object({
            hasNextPage: z.boolean(),
            endCursor: z.string(),
        }),
    }),
});

async function fetchFrozenPage(after?: string) {
    const cursor = after ? `, after: ${JSON.stringify(after)}` : "";
    const res = await graphqlAuth(
        config.accounts.graphql,
        `{
            frozenAccounts(first: ${PAGE_SIZE}${cursor}) {
                edges { node { account authService } }
                pageInfo { hasNextPage endCursor }
            }
        }`,
    );
    const parsed = zFrozenPage.parse(res);
    return {
        accounts: parsed.frozenAccounts.edges.map((edge) => edge.node),
        hasNextPage: parsed.frozenAccounts.pageInfo.hasNextPage,
        endCursor: parsed.frozenAccounts.pageInfo.endCursor,
    };
}

export const useFrozenAccounts = () => {
    const query = useInfiniteQuery({
        queryKey: QueryKey.frozenAccounts(),
        initialPageParam: undefined as string | undefined,
        queryFn: ({ pageParam }) => fetchFrozenPage(pageParam),
        getNextPageParam: (last) =>
            last.hasNextPage && last.endCursor ? last.endCursor : undefined,
    });

    const accounts =
        query.data?.pages.flatMap((page) => page.accounts) ?? [];

    return { ...query, accounts };
};
