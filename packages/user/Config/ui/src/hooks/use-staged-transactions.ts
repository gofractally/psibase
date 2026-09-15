import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import QueryKey from "@/lib/query-keys";

import { callGraphqlViaPlugin } from "@shared/lib/graphql/call-graphql-via-plugin";
import { config } from "@shared/lib/plugins";
import { zAccount } from "@shared/lib/schemas/account";

const zResponse = z.object({
    getStaged: z.object({
        nodes: z
            .object({
                id: z.number(),
                txid: z.string(),
                proposer: zAccount,
                proposeDate: z.string(),
            })
            .array(),
    }),
});

export const useStagedTransactions = () => {
    return useQuery({
        queryKey: QueryKey.stagedTransactions(),
        queryFn: async () => {
            const res = await callGraphqlViaPlugin(
                config.staged.graphql,
                `
                    {
                        getStaged(last: 1000) {
                            nodes {
                                id
                                txid
                                proposer
                                proposeDate
                            }
                        }
                    }
                `,
            );

            return zResponse
                .parse(res)
                .getStaged.nodes.sort((a, b) => b.id - a.id);
        },
    });
};
