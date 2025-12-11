import { z } from "zod";

import { graphql } from "./graphql";
import { Account } from "./zod/Account";

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
    const res = await graphql(
        ` { 
        getStagedByProposer(proposer: "${account}") {
                nodes {
                    id
                    txid
                }
        }
    }`,
        "staged-tx",
    );

    return zRes.parse(res).getStagedByProposer.nodes;
};
