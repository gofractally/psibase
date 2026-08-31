import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import QueryKey from "@/lib/query-keys";

import { authorizedPluginGraphql } from "@shared/lib/graphql/authorized-plugin";
import { stagedTx } from "@shared/lib/plugins";
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
            const res = await authorizedPluginGraphql(
                stagedTx.authorized.graphql,
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
