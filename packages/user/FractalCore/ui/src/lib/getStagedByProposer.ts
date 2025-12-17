import { z } from "zod";

import { Account } from "@shared/lib/schemas/account";

import { graphql } from "./graphql";

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
