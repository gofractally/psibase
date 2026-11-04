import type { Account } from "@shared/lib/schemas/account";

import { z } from "zod";

import { graphqlAuth } from "@shared/lib/graphql/graphql-auth";
import { config } from "@shared/lib/plugins";

const zRes = z.object({
    getStagedByProposer: z.object({
        nodes: z
            .object({
                id: z.number(),
                txid: z.string(),
            })
            .array(),
    }),
});

export const getStagedByProposer = async (account: Account) => {
    const res = await graphqlAuth(
        config.staged.graphql,
        ` { 
        getStagedByProposer(proposer: "${account}") {
                nodes {
                    id
                    txid
                }
        }
    }`,
    );

    return zRes.parse(res).getStagedByProposer.nodes;
};
