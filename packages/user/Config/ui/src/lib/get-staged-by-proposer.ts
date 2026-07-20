import type { Account } from "@shared/lib/schemas/account";

import { z } from "zod";

import { graphql } from "@shared/lib/graphql";

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
        { service: "staged-tx" },
    );

    return zRes.parse(res).getStagedByProposer.nodes;
};
