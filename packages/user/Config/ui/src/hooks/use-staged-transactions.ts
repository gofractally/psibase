import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { siblingUrl } from "@psibase/common-lib";

import { graphql } from "@/lib/graphql";
import QueryKey from "@/lib/queryKeys";
import { zAccount } from "@/lib/zod/Account";

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
            const res = await graphql(
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
                siblingUrl(null, "staged-tx", "/graphql"),
            );

            return zResponse
                .parse(res)
                .getStaged.nodes.sort((a, b) => b.id - a.id);
        },
    });
};
