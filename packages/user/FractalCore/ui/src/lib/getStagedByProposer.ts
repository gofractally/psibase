import { z } from "zod";

import { siblingUrl } from "@psibase/common-lib";

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
        siblingUrl(null, "staged-tx", "/graphql"),
    );

    return zRes.parse(res).getStagedByProposer.nodes;
};
