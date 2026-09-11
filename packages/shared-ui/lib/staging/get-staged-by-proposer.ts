import { z } from "zod";

import { callGraphqlViaPlugin } from "@shared/lib/graphql/call-graphql-via-plugin";
import { stagedTx } from "@shared/lib/plugins";
import { Account } from "@shared/lib/schemas/account";

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
    const res = await callGraphqlViaPlugin(
        stagedTx.authorized.graphql,
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
