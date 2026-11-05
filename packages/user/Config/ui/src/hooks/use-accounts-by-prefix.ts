import { useInfiniteQuery } from "@tanstack/react-query";
import { z } from "zod";

import QueryKey from "@/lib/query-keys";

import { graphqlAuth } from "@shared/lib/graphql/graphql-auth";
import { config } from "@shared/lib/plugins";

const PAGE_SIZE = 50;

const accountPrefix = /^[a-z0-9][a-z0-9-]*$/;

const zAccountPage = z.object({
    accountsByPre: z.object({
        edges: z.array(
            z.object({
                node: z.object({
                    accountNum: z.string(),
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

async function fetchAccountPage(prefix: string, after?: string) {
    const cursor = after ? `, after: ${JSON.stringify(after)}` : "";
    const res = await graphqlAuth(
        config.accounts.graphql,
        `{
            accountsByPre(prefix: ${JSON.stringify(prefix)}, first: ${PAGE_SIZE}${cursor}) {
                edges { node { accountNum authService } }
                pageInfo { hasNextPage endCursor }
            }
        }`,
    );
    const parsed = zAccountPage.parse(res);
    return {
        accounts: parsed.accountsByPre.edges.map((edge) => ({
            account: edge.node.accountNum,
            authService: edge.node.authService,
        })),
        hasNextPage: parsed.accountsByPre.pageInfo.hasNextPage,
        endCursor: parsed.accountsByPre.pageInfo.endCursor,
    };
}

export const useAccountsByPrefix = (rawPrefix: string) => {
    const prefix = rawPrefix.trim().toLowerCase();
    const isValid = prefix.length === 0 || accountPrefix.test(prefix);
    const queryPrefix = isValid ? prefix : "";

    const query = useInfiniteQuery({
        queryKey: QueryKey.accountsByPrefix(queryPrefix),
        enabled: queryPrefix.length > 0,
        initialPageParam: undefined as string | undefined,
        queryFn: ({ pageParam }) => fetchAccountPage(queryPrefix, pageParam),
        getNextPageParam: (last) =>
            last.hasNextPage && last.endCursor ? last.endCursor : undefined,
    });

    const accounts =
        query.data?.pages.flatMap((page) => page.accounts) ?? [];

    return {
        ...query,
        accounts,
        isValid,
        prefix: queryPrefix,
    };
};
